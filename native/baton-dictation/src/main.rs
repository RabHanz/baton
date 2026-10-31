//! Baton's native dictation: Handy's engine stack (transcribe.cpp, handy-recorder, handy-keys) and
//! its Windows paste, behind JSON lines on stdin/stdout, so Electron stays out of the audio path.
//! See docs/baton/VOICE.md. Run with no arguments it serves; the subcommands are for voice-lab.
#[cfg(unix)]
mod desktop_unix;
mod keys;
#[cfg(windows)]
mod uia;
mod live;
#[cfg(windows)]
mod paste_windows;

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use enigo::Enigo;
#[cfg(not(target_os = "linux"))]
use enigo::Settings;
use handy_keys::{Hotkey, HotkeyManager, HotkeyState};
use handy_recorder::{
    list_input_devices, AudioChunk, Channels, Recorder, RecorderConfig, Sink,
};
use keys::PasteMethod;
use live::{lift_gain, words_after, ChunkParams, Chunker, Piece};
use serde::Deserialize;
use serde_json::{json, Value};
use transcribe_cpp::{
    init_backends_with, BackendMask, Feature, Model, RunOptions, Session, SessionOptions, TimestampKind,
};

const IDLE_UNLOAD: Duration = Duration::from_secs(600);
const MIN_SAMPLES: usize = 16_000 / 4;
/// A tap of the remote's button must not listen forever. What was said is kept, never pasted.
const MAX_RECORDING: Duration = Duration::from_secs(300);
/// Parakeet clips the last word without a little trailing silence.
const TAIL_SAMPLES: usize = 16_000 / 5;

fn emit(event: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{event}");
    let _ = out.flush();
}

#[derive(Deserialize, Default, Clone)]
struct Config {
    model: Option<PathBuf>,
    hold: Option<String>,
    toggle: Option<String>,
    device: Option<String>,
    /// One input of a multi-input interface: the AT2020 is input 1 of the Scarlett.
    channel: Option<u16>,
    #[serde(default)]
    paste: PasteMethod,
    language: Option<String>,
    /// The desktop cleans the text up first, then pastes it with `target`.
    #[serde(default)]
    cleanup: bool,
}

enum Msg {
    Line(String),
    Key { hold: bool, pressed: bool },
    MicFailed(String),
    /// A fake microphone ran out of file, which stands in for releasing the key.
    FakeEnded,
    Finished { id: Option<u64>, dictated: bool, target: Option<isize>, result: Result<Done, String> },
}

struct Done {
    text: String,
    audio_ms: u64,
    infer_ms: u64,
    load_ms: u64,
    /// From key release to text; None for a clip that was never live.
    release_ms: Option<u64>,
    pieces: u64,
}

struct Job {
    id: Option<u64>,
    dictated: bool,
    /// The window to paste back into; None never pastes.
    target: Option<isize>,
    pcm: Vec<f32>,
    model: PathBuf,
    language: Option<String>,
}

enum Work {
    Clip(Job),
    Begin { model: PathBuf, language: Option<String> },
    Audio(Vec<f32>),
    End { target: Option<isize>, released: Instant },
    Abort,
}

fn load(model: &Path) -> Result<(Session, u64), String> {
    let started = Instant::now();
    // ggml loses more than it gains on hyperthreads; BATON_THREADS is for measuring that.
    let n_threads = std::env::var("BATON_THREADS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| thread::available_parallelism().map_or(4, |n| (n.get() / 2).max(2) as i32));
    let session = Model::load(model)
        .and_then(|m| m.session_with(&SessionOptions { n_threads, ..Default::default() }))
        .map_err(|e| format!("could not load {}: {e}", model.display()))?;
    Ok((session, started.elapsed().as_millis() as u64))
}

fn infer(session: &mut Session, pcm: &mut Vec<f32>, language: Option<String>) -> Result<(String, u64, u64), String> {
    let audio_ms = pcm.len() as u64 / 16;
    lift_gain(pcm);
    pcm.resize(pcm.len() + TAIL_SAMPLES, 0.0);
    let started = Instant::now();
    let options = RunOptions { language, ..Default::default() };
    let result = session.run(pcm, &options).map_err(|e| format!("transcribe: {e}"))?;
    Ok((result.text.trim().to_string(), audio_ms, started.elapsed().as_millis() as u64))
}

/// The new words of one piece; the context before them only helps the model hear them.
fn decode_piece(session: &mut Session, piece: Piece, language: Option<String>) -> Result<String, String> {
    let Piece { mut pcm, context } = piece;
    lift_gain(&mut pcm);
    pcm.resize(pcm.len() + TAIL_SAMPLES, 0.0);
    let options = RunOptions { language, timestamps: TimestampKind::Word, ..Default::default() };
    let result = session.run(&pcm, &options).map_err(|e| format!("transcribe: {e}"))?;
    if context == 0 || result.words.is_empty() {
        return Ok(result.text.trim().to_string());
    }
    Ok(words_after(result.words.iter().map(|w| (w.t0_ms, w.text.as_str())), context as i64 / 16))
}

/// One recording on its way through the model.
struct Live {
    chunker: Chunker,
    /// Everything heard: a piece that fails falls back to the whole recording.
    heard: Vec<f32>,
    language: Option<String>,
    text: Vec<String>,
    load_ms: u64,
    infer_ms: u64,
    pieces: u64,
    failed: Option<String>,
}

impl Live {
    fn new(language: Option<String>, load_ms: u64, failed: Option<String>) -> Self {
        Self {
            chunker: Chunker::new(ChunkParams::from_env()),
            heard: Vec::new(),
            language,
            text: Vec::new(),
            load_ms,
            infer_ms: 0,
            pieces: 0,
            failed,
        }
    }

    fn decode(&mut self, session: &mut Session, piece: Piece) {
        let started = Instant::now();
        match decode_piece(session, piece, self.language.clone()) {
            Ok(text) if text.is_empty() => {}
            Ok(text) => self.text.push(text),
            Err(e) => self.failed = Some(e),
        }
        self.infer_ms += started.elapsed().as_millis() as u64;
        self.pieces += 1;
    }

    fn finish(mut self, session: Option<&mut Session>, released: Instant) -> Result<Done, String> {
        let audio_ms = self.heard.len() as u64 / 16;
        let session = session.ok_or_else(|| self.failed.clone().unwrap_or_else(|| "no model".to_string()))?;
        if self.failed.is_none() {
            if let Some(piece) = self.chunker.finish() {
                self.decode(session, piece);
            }
        }
        let text = if self.failed.is_some() {
            infer(session, &mut self.heard, self.language.clone())?.0
        } else {
            self.text.join(" ")
        };
        Ok(Done {
            text,
            audio_ms,
            infer_ms: self.infer_ms,
            load_ms: self.load_ms,
            release_ms: Some(released.elapsed().as_millis() as u64),
            pieces: self.pieces,
        })
    }
}

fn ensure_loaded(loaded: &mut Option<(PathBuf, Session)>, model: &Path) -> Result<u64, String> {
    if loaded.as_ref().is_some_and(|(path, _)| path == model) {
        return Ok(0);
    }
    *loaded = None;
    let (session, ms) = load(model)?;
    *loaded = Some((model.to_path_buf(), session));
    Ok(ms)
}

/// One thread owns the model. It loads on first use and leaves after ten idle minutes, because
/// 16 GB is shared with everything else on the laptop.
fn engine_thread(work: Receiver<Work>, out: Sender<Msg>) {
    let mut loaded: Option<(PathBuf, Session)> = None;
    let mut live: Option<Live> = None;
    loop {
        match work.recv_timeout(IDLE_UNLOAD) {
            Err(RecvTimeoutError::Timeout) => {
                if live.is_none() {
                    loaded = None;
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
            Ok(Work::Clip(mut job)) => {
                let result = ensure_loaded(&mut loaded, &job.model).and_then(|load_ms| {
                    let session = &mut loaded.as_mut().expect("loaded above").1;
                    infer(session, &mut job.pcm, job.language.take()).map(|(text, audio_ms, infer_ms)| Done {
                        text,
                        audio_ms,
                        infer_ms,
                        load_ms,
                        release_ms: None,
                        pieces: 1,
                    })
                });
                let _ = out.send(Msg::Finished { id: job.id, dictated: job.dictated, target: job.target, result });
            }
            Ok(Work::Begin { model, language }) => {
                live = Some(match ensure_loaded(&mut loaded, &model) {
                    Ok(load_ms) => Live::new(language, load_ms, None),
                    Err(e) => {
                        loaded = None;
                        Live::new(language, 0, Some(e))
                    }
                });
            }
            Ok(Work::Audio(pcm)) => {
                let Some(current) = live.as_mut() else { continue };
                current.heard.extend_from_slice(&pcm);
                if current.failed.is_none() {
                    if let (Some(piece), Some((_, session))) = (current.chunker.push(&pcm), loaded.as_mut()) {
                        current.decode(session, piece);
                    }
                }
            }
            Ok(Work::End { target, released }) => {
                let Some(current) = live.take() else { continue };
                let result = current.finish(loaded.as_mut().map(|(_, session)| session), released);
                let _ = out.send(Msg::Finished { id: None, dictated: true, target, result });
            }
            Ok(Work::Abort) => live = None,
        }
    }
}

fn read_wav(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let spec = reader.spec();
    if spec.sample_rate != 16_000 || spec.channels != 1 || spec.bits_per_sample != 16 {
        return Err(format!("{}: needs 16 kHz mono 16-bit", path.display()));
    }
    reader
        .samples::<i16>()
        .map(|s| s.map(|v| v as f32 / 32768.0).map_err(|e| e.to_string()))
        .collect()
}

fn devices_json() -> Value {
    match list_input_devices() {
        Ok(devices) => devices
            .iter()
            .map(|d| json!({"id": d.id, "name": d.name, "channels": d.channels, "isDefault": d.is_default}))
            .collect(),
        Err(_) => json!([]),
    }
}

fn recorder_config(device: Option<&str>, channel: Option<u16>) -> Result<RecorderConfig, String> {
    let mut config = RecorderConfig::speech();
    if let Some(wanted) = device {
        let devices = list_input_devices().map_err(|e| e.to_string())?;
        let found = devices
            .iter()
            .find(|d| d.name == wanted)
            .ok_or_else(|| format!("{wanted} is not connected"))?;
        config.device = Some(found.id.clone());
    }
    if let Some(index) = channel {
        config.channels = Channels::Only(index);
    }
    Ok(config)
}

fn paste_text(enigo: &mut Option<Enigo>, text: &str, method: PasteMethod) -> Result<(), String> {
    // Linux sends its chord through external tools: enigo there is X11 only.
    #[cfg(target_os = "linux")]
    {
        let _ = enigo;
        desktop_unix::paste(text, method)
    }
    #[cfg(not(target_os = "linux"))]
    {
        if enigo.is_none() {
            *enigo = Some(Enigo::new(&Settings::default()).map_err(|e| e.to_string())?);
        }
        let enigo = enigo.as_mut().expect("set above");
        #[cfg(windows)]
        return paste_windows::run(text, method, enigo);
        #[cfg(not(windows))]
        return desktop_unix::paste(text, method, enigo);
    }
}

/// Dropping it stops the hook thread, which owns the manager.
struct Keys(Arc<AtomicBool>);

impl Drop for Keys {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

fn start_keys(config: &Config, tx: &Sender<Msg>) -> Result<Option<Keys>, String> {
    if config.hold.is_none() && config.toggle.is_none() {
        return Ok(None);
    }
    // `new_with_blocking`: the chord must not also reach the focused app.
    let manager = HotkeyManager::new_with_blocking().map_err(|e| e.to_string())?;
    let register = |text: &Option<String>| -> Result<_, String> {
        match text {
            Some(text) => {
                let hotkey: Hotkey = text.parse().map_err(|e| format!("{text}: {e}"))?;
                manager.register(hotkey).map(Some).map_err(|e| format!("{text}: {e}"))
            }
            None => Ok(None),
        }
    };
    let hold = register(&config.hold)?;
    register(&config.toggle)?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let tx = tx.clone();
    thread::spawn(move || {
        while !stopped.load(Ordering::Relaxed) {
            match manager.try_recv() {
                Some(event) => {
                    let pressed = event.state == HotkeyState::Pressed;
                    let _ = tx.send(Msg::Key { hold: Some(event.id) == hold, pressed });
                }
                None => thread::sleep(Duration::from_millis(5)),
            }
        }
    });
    Ok(Some(Keys(stop)))
}

/// Hands the microphone to the engine as it arrives.
struct LiveSink {
    work: Sender<Work>,
    samples: Arc<AtomicUsize>,
}

impl Sink for LiveSink {
    fn process_chunk(&mut self, chunk: AudioChunk<'_>) {
        let samples = chunk.samples[..chunk.valid_frames].to_vec();
        self.samples.fetch_add(samples.len(), Ordering::Relaxed);
        let _ = self.work.send(Work::Audio(samples));
    }
}

enum Source {
    Mic(Recorder<LiveSink>),
    Fake(Arc<AtomicBool>),
}

struct Recording {
    source: Source,
    samples: Arc<AtomicUsize>,
    started: Instant,
    target: isize,
}

impl Drop for Recording {
    fn drop(&mut self) {
        if let Source::Fake(stop) = &self.source {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// BATON_FAKE_MIC=<wav>, re-read on each recording: the file plays at real-time pace through the
/// path a microphone takes, so latency can be measured with nobody speaking. It never pastes.
fn fake_mic() -> Option<PathBuf> {
    std::env::var_os("BATON_FAKE_MIC").map(PathBuf::from)
}

fn play_fake(path: &Path, work: Sender<Work>, samples: Arc<AtomicUsize>, stop: Arc<AtomicBool>, tx: Sender<Msg>) -> Result<(), String> {
    let pcm = read_wav(path)?;
    thread::spawn(move || {
        let started = Instant::now();
        for (i, chunk) in pcm.chunks(480).enumerate() {
            let due = started + Duration::from_millis(30 * i as u64);
            thread::sleep(due.saturating_duration_since(Instant::now()));
            if stop.load(Ordering::Relaxed) {
                return;
            }
            samples.fetch_add(chunk.len(), Ordering::Relaxed);
            let _ = work.send(Work::Audio(chunk.to_vec()));
        }
        let _ = tx.send(Msg::FakeEnded);
    });
    Ok(())
}

#[cfg(windows)]
fn foreground_window() -> isize {
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow().0 as isize }
}

#[cfg(unix)]
use desktop_unix::{foreground_window, window_app};

#[cfg(not(any(windows, unix)))]
fn foreground_window() -> isize {
    0
}

/// Which app a window belongs to and what its title says, for choosing a writing mode.
#[cfg(windows)]
fn window_app(window: isize) -> (String, String) {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextW, GetWindowThreadProcessId};
    let hwnd = HWND(window as *mut _);
    let mut title = [0u16; 256];
    let length = unsafe { GetWindowTextW(hwnd, &mut title) }.max(0) as usize;
    let title = String::from_utf16_lossy(&title[..length]);
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    let mut exe = String::new();
    if let Ok(process) = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        let mut path = [0u16; 1024];
        let mut size = path.len() as u32;
        if unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut size) }.is_ok() {
            let full = String::from_utf16_lossy(&path[..size as usize]);
            exe = full.rsplit('\\').next().unwrap_or("").to_lowercase();
        }
        let _ = unsafe { CloseHandle(process) };
    }
    (exe, title)
}

#[cfg(not(any(windows, unix)))]
fn window_app(_window: isize) -> (String, String) {
    (String::new(), String::new())
}

#[cfg(windows)]
fn window_rect(window: isize) -> Value {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut r = RECT::default();
    match unsafe { GetWindowRect(HWND(window as *mut _), &mut r) } {
        Ok(()) => json!({"x": r.left, "y": r.top, "width": r.right - r.left, "height": r.bottom - r.top}),
        Err(_) => Value::Null,
    }
}

#[cfg(not(windows))]
fn window_rect(_window: isize) -> Value {
    Value::Null
}

/// Lab only: real mouse input with no process starting, to stand in for his hand during a drive.
#[cfg(windows)]
fn nudge(dx: i32, dy: i32) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_MOVE, MOUSEINPUT,
    };
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT { dx, dy, mouseData: 0, dwFlags: MOUSEEVENTF_MOVE, time: 0, dwExtraInfo: 0 },
        },
    };
    unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
}

#[cfg(not(windows))]
fn nudge(_dx: i32, _dy: i32) {}

#[cfg(windows)]
fn window_at(x: i32, y: i32) -> isize {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT};
    unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT).0 as isize }
}

#[cfg(not(windows))]
fn window_at(_x: i32, _y: i32) -> isize {
    0
}

#[cfg(windows)]
fn locate_element(id: Option<u64>, label: &str, x: i32, y: i32) -> Value {
    let mut out = uia::locate(label, x, y).unwrap_or_else(|e| json!({"found": false, "error": e}));
    out["ev"] = json!("located");
    out["id"] = json!(id);
    out
}

#[cfg(not(windows))]
fn locate_element(id: Option<u64>, _label: &str, _x: i32, _y: i32) -> Value {
    json!({"ev": "located", "id": id, "found": false, "error": "not on this platform yet"})
}

/// Text goes only into the window it was spoken for. Windows reports 0 mid-switch, which is not it.
fn should_paste(target: Option<isize>, now: isize) -> bool {
    matches!(target, Some(window) if window != 0 && window == now)
}

fn over_limit(held: Duration) -> bool {
    held >= MAX_RECORDING
}

fn serve() {
    let (tx, rx) = channel::<Msg>();
    let (job_tx, job_rx) = channel::<Work>();
    {
        let tx = tx.clone();
        thread::spawn(move || engine_thread(job_rx, tx));
    }
    {
        let tx = tx.clone();
        thread::spawn(move || {
            for line in std::io::stdin().lock().lines().map_while(Result::ok) {
                let _ = tx.send(Msg::Line(line));
            }
            // Electron went away: nothing is left to serve.
            std::process::exit(0);
        });
    }

    let mut config = Config::default();
    let mut keys: Option<Keys> = None;
    let mut enigo = None;
    let mut recording: Option<Recording> = None;
    let mut held = false;
    let mut toggle_down = false;
    emit(json!({"ev": "ready", "devices": devices_json()}));

    let begin = |config: &Config, recording: &mut Option<Recording>, tx: &Sender<Msg>, job_tx: &Sender<Work>| {
        if recording.is_some() {
            return;
        }
        let Some(model) = config.model.clone() else {
            emit(json!({"ev": "error", "message": "no model configured"}));
            return;
        };
        let _ = job_tx.send(Work::Begin { model, language: config.language.clone() });
        let samples = Arc::new(AtomicUsize::new(0));
        let opened = match fake_mic() {
            Some(path) => {
                let stop = Arc::new(AtomicBool::new(false));
                play_fake(&path, job_tx.clone(), samples.clone(), stop.clone(), tx.clone()).map(|()| Source::Fake(stop))
            }
            None => {
                let tx = tx.clone();
                let sink = LiveSink { work: job_tx.clone(), samples: samples.clone() };
                recorder_config(config.device.as_deref(), config.channel).and_then(|cfg| {
                    let recorder = Recorder::open_with_failure_handler(cfg, move |e| {
                        let _ = tx.send(Msg::MicFailed(e.to_string()));
                    })
                    .map_err(|e| e.to_string())?;
                    recorder.start(sink).map_err(|e| e.to_string())?;
                    Ok(Source::Mic(recorder))
                })
            }
        };
        match opened {
            Ok(source) => {
                let target = foreground_window();
                let (app, title) = window_app(target);
                *recording = Some(Recording { source, samples, started: Instant::now(), target });
                emit(json!({"ev": "recording", "app": app, "title": title}));
            }
            Err(message) => {
                let _ = job_tx.send(Work::Abort);
                emit(json!({"ev": "error", "message": message}));
            }
        }
    };
    let finish = |recording: &mut Option<Recording>, job_tx: &Sender<Work>, paste: bool| {
        let Some(current) = recording.take() else { return };
        let released = Instant::now();
        let held_for = current.started.elapsed();
        // A fake microphone must never reach his keyboard.
        let target = (paste && matches!(current.source, Source::Mic(_))).then_some(current.target);
        let samples = current.samples.clone();
        let stopped = match &current.source {
            Source::Mic(recorder) => recorder.stop().map(drop).map_err(|e| e.to_string()),
            Source::Fake(_) => Ok(()),
        };
        match stopped {
            Ok(()) if samples.load(Ordering::Relaxed) >= MIN_SAMPLES => {
                emit(json!({"ev": "transcribing", "heldMs": held_for.as_millis() as u64}));
                let _ = job_tx.send(Work::End { target, released });
            }
            Ok(()) => {
                let _ = job_tx.send(Work::Abort);
                emit(json!({"ev": "idle"}));
            }
            Err(message) => {
                let _ = job_tx.send(Work::Abort);
                emit(json!({"ev": "error", "message": message}));
            }
        }
    };

    loop {
        let message = match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(message) => message,
            Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {
                if recording.as_ref().is_some_and(|r| over_limit(r.started.elapsed())) {
                    held = false;
                    finish(&mut recording, &job_tx, false);
                }
                continue;
            }
        };
        match message {
            Msg::Line(line) => {
                let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
                match value["cmd"].as_str().unwrap_or("") {
                    "configure" => {
                        match serde_json::from_value::<Config>(value.clone()) {
                            Ok(next) => {
                                let rebind = next.hold != config.hold || next.toggle != config.toggle;
                                config = next;
                                if rebind {
                                    // Nothing can stop a recording once its keys are gone.
                                    if recording.take().is_some() {
                                        let _ = job_tx.send(Work::Abort);
                                        held = false;
                                        emit(json!({"ev": "idle"}));
                                    }
                                    keys = None;
                                    thread::sleep(Duration::from_millis(30));
                                    match start_keys(&config, &tx) {
                                        Ok(started) => keys = started,
                                        Err(message) => emit(json!({"ev": "error", "message": message})),
                                    }
                                }
                                emit(json!({"ev": "configured"}));
                            }
                            Err(e) => emit(json!({"ev": "error", "message": e.to_string()})),
                        }
                    }
                    "devices" => emit(json!({"ev": "devices", "devices": devices_json()})),
                    "foreground" => {
                        let window = foreground_window();
                        let (app, title) = window_app(window);
                        emit(json!({"ev": "foreground", "id": value["id"].as_u64(), "rect": window_rect(window), "app": app, "title": title, "window": window as i64}));
                    }
                    "nudge" if std::env::var_os("BATON_LAB").is_some() => nudge(
                        value["dx"].as_i64().unwrap_or(0) as i32,
                        value["dy"].as_i64().unwrap_or(0) as i32,
                    ),
                    "window_at" => {
                        let (x, y) = (value["x"].as_i64().unwrap_or(0) as i32, value["y"].as_i64().unwrap_or(0) as i32);
                        let window = window_at(x, y);
                        let (app, title) = window_app(window);
                        emit(json!({"ev": "window_at", "id": value["id"].as_u64(), "window": window as i64, "app": app, "title": title}));
                    }
                    "locate" => {
                        let id = value["id"].as_u64();
                        let label = value["label"].as_str().unwrap_or("").to_string();
                        let (x, y) = (value["x"].as_i64().unwrap_or(0) as i32, value["y"].as_i64().unwrap_or(0) as i32);
                        // Its own thread: a big page can take a while, and the keys must not wait.
                        thread::spawn(move || emit(locate_element(id, &label, x, y)));
                    }
                    "toggle" => {
                        if recording.is_some() {
                            finish(&mut recording, &job_tx, true);
                        } else {
                            begin(&config, &mut recording, &tx, &job_tx);
                        }
                    }
                    "cancel" => {
                        recording = None;
                        let _ = job_tx.send(Work::Abort);
                        held = false;
                        emit(json!({"ev": "idle"}));
                    }
                    "transcribe" => {
                        let id = value["id"].as_u64();
                        let wav = value["wav"].as_str().unwrap_or("");
                        match (read_wav(Path::new(wav)), &config.model) {
                            (Ok(pcm), Some(model)) => {
                                let _ = job_tx.send(Work::Clip(Job {
                                    id,
                                    dictated: false,
                                    target: None,
                                    pcm,
                                    model: model.clone(),
                                    language: config.language.clone(),
                                }));
                            }
                            (Err(message), _) => emit(json!({"ev": "text", "id": id, "error": message})),
                            (_, None) => emit(json!({"ev": "text", "id": id, "error": "no model configured"})),
                        }
                    }
                    "paste" => {
                        let id = value["id"].as_u64();
                        let text = value["text"].as_str().unwrap_or("");
                        // With a target the text goes only into that window, as a dictation's does.
                        let target = value["target"].as_i64().map(|t| t as isize);
                        if target.is_some() && !should_paste(target, foreground_window()) {
                            emit(json!({"ev": "pasted", "id": id, "moved": true}));
                        } else {
                            let result = paste_text(&mut enigo, text, config.paste);
                            emit(json!({"ev": "pasted", "id": id, "error": result.err()}));
                        }
                    }
                    "quit" => return,
                    _ => {}
                }
            }
            Msg::Key { hold: true, pressed: true } => {
                held = true;
                begin(&config, &mut recording, &tx, &job_tx);
            }
            Msg::Key { hold: true, pressed: false } => {
                if held {
                    held = false;
                    finish(&mut recording, &job_tx, true);
                }
            }
            Msg::Key { hold: false, pressed: true } => {
                if !toggle_down {
                    toggle_down = true;
                    if recording.is_some() {
                        finish(&mut recording, &job_tx, true);
                    } else {
                        begin(&config, &mut recording, &tx, &job_tx);
                    }
                }
            }
            Msg::Key { hold: false, pressed: false } => toggle_down = false,
            Msg::FakeEnded => finish(&mut recording, &job_tx, true),
            Msg::MicFailed(message) => {
                recording = None;
                let _ = job_tx.send(Work::Abort);
                held = false;
                emit(json!({"ev": "error", "message": message}));
            }
            Msg::Finished { id, dictated, target, result } => match result {
                Ok(done) => {
                    let mut pasted_error = None;
                    let paste = dictated && !config.cleanup && should_paste(target, foreground_window());
                    if paste && !done.text.is_empty() {
                        pasted_error = paste_text(&mut enigo, &done.text, config.paste).err();
                    }
                    emit(json!({
                        "ev": "text", "id": id, "text": done.text, "audioMs": done.audio_ms,
                        "inferMs": done.infer_ms, "loadMs": done.load_ms, "pasteError": pasted_error,
                        "dictated": dictated, "pasted": paste, "target": target,
                        "releaseMs": done.release_ms, "pieces": done.pieces,
                    }));
                }
                Err(message) => emit(json!({"ev": "text", "id": id, "error": message, "dictated": dictated})),
            },
        }
    }
}

/// Raw 16-bit PCM to stdout, for voice-lab's scorer.
struct StdoutSink;

impl Sink for StdoutSink {
    fn process_chunk(&mut self, chunk: AudioChunk<'_>) {
        let bytes: Vec<u8> = chunk.samples[..chunk.valid_frames]
            .iter()
            .flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())
            .collect();
        let mut out = std::io::stdout().lock();
        if out.write_all(&bytes).is_err() {
            std::process::exit(0);
        }
    }
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn cli_transcribe(args: &[String]) -> Result<(), String> {
    let model = flag(args, "--model").ok_or("--model is required")?;
    let language = flag(args, "--language");
    let (mut session, load_ms) = load(Path::new(&model))?;
    emit(json!({"ev": "loaded", "loadMs": load_ms}));
    let list = flag(args, "--list");
    let files: Vec<String> = match list {
        Some(path) => std::fs::read_to_string(path)
            .map_err(|e| e.to_string())?
            .lines()
            .map(str::to_string)
            .collect(),
        None => args.iter().filter(|a| a.ends_with(".wav")).cloned().collect(),
    };
    for file in files {
        let result = read_wav(Path::new(&file))
            .and_then(|mut pcm| infer(&mut session, &mut pcm, language.clone()));
        match result {
            Ok((text, audio_ms, infer_ms)) => {
                emit(json!({"file": file, "text": text, "audioMs": audio_ms, "inferMs": infer_ms}))
            }
            Err(error) => emit(json!({"file": file, "error": error})),
        }
    }
    Ok(())
}

/// Live chunking with no pacing, for sweeping its settings: `finalMs` is what is left at release
/// when decoding has kept up, which the real-time replay confirms.
fn cli_chunked(args: &[String]) -> Result<(), String> {
    let model = flag(args, "--model").ok_or("--model is required")?;
    let language = flag(args, "--language");
    let (mut session, load_ms) = load(Path::new(&model))?;
    let loaded = Model::load(Path::new(&model)).map_err(|e| e.to_string())?;
    let caps = loaded.capabilities().map_err(|e| e.to_string())?;
    emit(json!({"ev": "loaded", "loadMs": load_ms, "streaming": caps.supports_streaming,
        "vocabulary": loaded.supports(Feature::Vocabulary), "arch": loaded.arch(), "variant": loaded.variant()}));
    let list = std::fs::read_to_string(flag(args, "--list").ok_or("--list is required")?).map_err(|e| e.to_string())?;
    for file in list.lines() {
        let pcm = match read_wav(Path::new(file)) {
            Ok(pcm) => pcm,
            Err(error) => {
                emit(json!({"file": file, "error": error}));
                continue;
            }
        };
        let mut chunker = Chunker::new(ChunkParams::from_env());
        let mut text: Vec<String> = Vec::new();
        let started = Instant::now();
        for chunk in pcm.chunks(480) {
            if let Some(piece) = chunker.push(chunk) {
                text.push(decode_piece(&mut session, piece, language.clone())?);
            }
        }
        let busy = started.elapsed().as_millis() as u64;
        let last = chunker.finish();
        let last_seconds = last.as_ref().map_or(0.0, |p| p.pcm.len() as f64 / 16_000.0);
        let released = Instant::now();
        if let Some(piece) = last {
            text.push(decode_piece(&mut session, piece, language.clone())?);
        }
        emit(json!({"file": file, "text": text.join(" "), "audioMs": pcm.len() as u64 / 16, "inferMs": busy,
            "finalMs": released.elapsed().as_millis() as u64, "lastSeconds": last_seconds, "pieces": text.len()}));
    }
    Ok(())
}

fn cli_record(args: &[String]) -> Result<(), String> {
    let channel = flag(args, "--channel").and_then(|c| c.parse().ok());
    let config = recorder_config(flag(args, "--device").as_deref(), channel)?;
    let seconds: u64 = flag(args, "--seconds").and_then(|s| s.parse().ok()).unwrap_or(0);
    // Exit on a dead stream: the desktop only learns of it from this process ending.
    let recorder = Recorder::open_with_failure_handler(config, |e| {
        eprintln!("{e}");
        std::process::exit(3);
    })
    .map_err(|e| e.to_string())?;
    recorder.start(StdoutSink).map_err(|e| e.to_string())?;
    if seconds == 0 {
        loop {
            thread::sleep(Duration::from_secs(3600));
        }
    }
    thread::sleep(Duration::from_secs(seconds));
    recorder.stop().map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    // Without this Windows scales every coordinate here, so at 175 % the window and the element
    // under a physical point are the wrong ones.
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::HiDpi::{
            SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    if let Err(e) = init_backends_with(None::<&Path>, BackendMask::CPU) {
        emit(json!({"ev": "error", "message": format!("backend: {e}")}));
        std::process::exit(2);
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        None | Some("serve") => {
            serve();
            Ok(())
        }
        Some("devices") => {
            println!("{}", devices_json());
            Ok(())
        }
        Some("foreground") => {
            let window = foreground_window();
            let (app, title) = window_app(window);
            println!("{}", json!({"window": window, "app": app, "title": title}));
            Ok(())
        }
        Some("locate") => {
            let number = |name: &str| flag(&args, name).and_then(|v| v.parse().ok()).unwrap_or(0);
            let label = flag(&args, "--label").unwrap_or_default();
            println!("{}", locate_element(None, &label, number("--x"), number("--y")));
            Ok(())
        }
        Some("transcribe") => cli_transcribe(&args[1..]),
        Some("chunked") => cli_chunked(&args[1..]),
        Some("record") => cli_record(&args[1..]),
        Some(other) => Err(format!("unknown command {other}")),
    };
    if let Err(message) = result {
        eprintln!("{message}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pastes_only_into_the_window_it_was_spoken_for() {
        assert!(should_paste(Some(7), 7));
        assert!(!should_paste(Some(7), 8));
        assert!(!should_paste(None, 7));
        assert!(!should_paste(Some(0), 0));
    }

    #[test]
    fn a_recording_stops_at_the_limit() {
        assert!(!over_limit(MAX_RECORDING - Duration::from_secs(1)));
        assert!(over_limit(MAX_RECORDING));
    }
}
