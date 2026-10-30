//! Baton's native dictation: Handy's engine stack (transcribe.cpp, handy-recorder, handy-keys) and
//! its Windows paste, behind JSON lines on stdin/stdout, so Electron stays out of the audio path.
//! See docs/baton/VOICE.md. Run with no arguments it serves; the subcommands are for voice-lab.
mod keys;
#[cfg(windows)]
mod paste_windows;

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use enigo::{Enigo, Settings};
use handy_keys::{Hotkey, HotkeyManager, HotkeyState};
use handy_recorder::{
    list_input_devices, AudioChunk, Channels, CollectingSink, Recorder, RecorderConfig, Sink,
};
use keys::PasteMethod;
use serde::Deserialize;
use serde_json::{json, Value};
use transcribe_cpp::{init_backends_with, BackendMask, Model, RunOptions, Session};

const IDLE_UNLOAD: Duration = Duration::from_secs(600);
const MIN_SAMPLES: usize = 16_000 / 4;
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
}

enum Msg {
    Line(String),
    Key { hold: bool, pressed: bool },
    MicFailed(String),
    Finished { id: Option<u64>, paste: bool, result: Result<Done, String> },
}

struct Done {
    text: String,
    audio_ms: u64,
    infer_ms: u64,
    load_ms: u64,
}

struct Job {
    id: Option<u64>,
    paste: bool,
    pcm: Vec<f32>,
    model: PathBuf,
    language: Option<String>,
}

fn load(model: &Path) -> Result<(Session, u64), String> {
    let started = Instant::now();
    let session = Model::load(model)
        .and_then(|m| m.session())
        .map_err(|e| format!("could not load {}: {e}", model.display()))?;
    Ok((session, started.elapsed().as_millis() as u64))
}

fn infer(session: &mut Session, pcm: &mut Vec<f32>, language: Option<String>) -> Result<(String, u64, u64), String> {
    let audio_ms = pcm.len() as u64 / 16;
    pcm.resize(pcm.len() + TAIL_SAMPLES, 0.0);
    let started = Instant::now();
    let options = RunOptions { language, ..Default::default() };
    let result = session.run(pcm, &options).map_err(|e| format!("transcribe: {e}"))?;
    Ok((result.text.trim().to_string(), audio_ms, started.elapsed().as_millis() as u64))
}

/// One thread owns the model. It loads on first use and leaves after ten idle minutes, because
/// 16 GB is shared with everything else on the laptop.
fn engine_thread(jobs: std::sync::mpsc::Receiver<Job>, out: Sender<Msg>) {
    let mut loaded: Option<(PathBuf, Session)> = None;
    loop {
        let mut job = match jobs.recv_timeout(IDLE_UNLOAD) {
            Ok(job) => job,
            Err(RecvTimeoutError::Timeout) => {
                loaded = None;
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => return,
        };
        let mut load_ms = 0;
        if loaded.as_ref().map(|(path, _)| path != &job.model).unwrap_or(true) {
            loaded = None;
            match load(&job.model) {
                Ok((session, ms)) => {
                    load_ms = ms;
                    loaded = Some((job.model.clone(), session));
                }
                Err(e) => {
                    let _ = out.send(Msg::Finished { id: job.id, paste: job.paste, result: Err(e) });
                    continue;
                }
            }
        }
        let session = &mut loaded.as_mut().expect("loaded above").1;
        let result = infer(session, &mut job.pcm, job.language.take())
            .map(|(text, audio_ms, infer_ms)| Done { text, audio_ms, infer_ms, load_ms });
        let _ = out.send(Msg::Finished { id: job.id, paste: job.paste, result });
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
    if enigo.is_none() {
        *enigo = Some(Enigo::new(&Settings::default()).map_err(|e| e.to_string())?);
    }
    let enigo = enigo.as_mut().expect("set above");
    #[cfg(windows)]
    return paste_windows::run(text, method, enigo);
    #[cfg(not(windows))]
    {
        let _ = (text, method, enigo);
        Err("paste is Windows only".to_string())
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

struct Recording {
    recorder: Recorder<CollectingSink>,
    started: Instant,
}

fn serve() {
    let (tx, rx) = channel::<Msg>();
    let (job_tx, job_rx) = channel::<Job>();
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

    let begin = |config: &Config, recording: &mut Option<Recording>, tx: &Sender<Msg>| {
        if recording.is_some() {
            return;
        }
        let tx = tx.clone();
        let opened = recorder_config(config.device.as_deref(), config.channel).and_then(|cfg| {
            let recorder = Recorder::open_with_failure_handler(cfg, move |e| {
                let _ = tx.send(Msg::MicFailed(e.to_string()));
            })
            .map_err(|e| e.to_string())?;
            recorder.start(CollectingSink::new()).map_err(|e| e.to_string())?;
            Ok(recorder)
        });
        match opened {
            Ok(recorder) => {
                *recording = Some(Recording { recorder, started: Instant::now() });
                emit(json!({"ev": "recording"}));
            }
            Err(message) => emit(json!({"ev": "error", "message": message})),
        }
    };
    let finish = |config: &Config, recording: &mut Option<Recording>, job_tx: &Sender<Job>| {
        let Some(current) = recording.take() else { return };
        let held_for = current.started.elapsed();
        match current.recorder.stop().map(|s| s.sink.into_samples()).map_err(|e| e.to_string()) {
            Ok(pcm) if pcm.len() >= MIN_SAMPLES => match &config.model {
                Some(model) => {
                    emit(json!({"ev": "transcribing", "heldMs": held_for.as_millis() as u64}));
                    let _ = job_tx.send(Job {
                        id: None,
                        paste: true,
                        pcm,
                        model: model.clone(),
                        language: config.language.clone(),
                    });
                }
                None => emit(json!({"ev": "error", "message": "no model configured"})),
            },
            Ok(_) => emit(json!({"ev": "idle"})),
            Err(message) => emit(json!({"ev": "error", "message": message})),
        }
    };

    while let Ok(message) = rx.recv() {
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
                    "toggle" => {
                        if recording.is_some() {
                            finish(&config, &mut recording, &job_tx);
                        } else {
                            begin(&config, &mut recording, &tx);
                        }
                    }
                    "cancel" => {
                        recording = None;
                        emit(json!({"ev": "idle"}));
                    }
                    "transcribe" => {
                        let id = value["id"].as_u64();
                        let wav = value["wav"].as_str().unwrap_or("");
                        match (read_wav(Path::new(wav)), &config.model) {
                            (Ok(pcm), Some(model)) => {
                                let _ = job_tx.send(Job {
                                    id,
                                    paste: false,
                                    pcm,
                                    model: model.clone(),
                                    language: config.language.clone(),
                                });
                            }
                            (Err(message), _) => emit(json!({"ev": "text", "id": id, "error": message})),
                            (_, None) => emit(json!({"ev": "text", "id": id, "error": "no model configured"})),
                        }
                    }
                    "paste" => {
                        let id = value["id"].as_u64();
                        let text = value["text"].as_str().unwrap_or("");
                        let result = paste_text(&mut enigo, text, config.paste);
                        emit(json!({"ev": "pasted", "id": id, "error": result.err()}));
                    }
                    "quit" => return,
                    _ => {}
                }
            }
            Msg::Key { hold: true, pressed: true } => {
                held = true;
                begin(&config, &mut recording, &tx);
            }
            Msg::Key { hold: true, pressed: false } => {
                if held {
                    held = false;
                    finish(&config, &mut recording, &job_tx);
                }
            }
            Msg::Key { hold: false, pressed: true } => {
                if !toggle_down {
                    toggle_down = true;
                    if recording.is_some() {
                        finish(&config, &mut recording, &job_tx);
                    } else {
                        begin(&config, &mut recording, &tx);
                    }
                }
            }
            Msg::Key { hold: false, pressed: false } => toggle_down = false,
            Msg::MicFailed(message) => {
                recording = None;
                held = false;
                emit(json!({"ev": "error", "message": message}));
            }
            Msg::Finished { id, paste, result } => match result {
                Ok(done) => {
                    let mut pasted_error = None;
                    if paste && !done.text.is_empty() {
                        pasted_error = paste_text(&mut enigo, &done.text, config.paste).err();
                    }
                    emit(json!({
                        "ev": "text", "id": id, "text": done.text, "audioMs": done.audio_ms,
                        "inferMs": done.infer_ms, "loadMs": done.load_ms, "pasteError": pasted_error,
                        "dictated": paste,
                    }));
                }
                Err(message) => emit(json!({"ev": "text", "id": id, "error": message, "dictated": paste})),
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

fn cli_record(args: &[String]) -> Result<(), String> {
    let channel = flag(args, "--channel").and_then(|c| c.parse().ok());
    let config = recorder_config(flag(args, "--device").as_deref(), channel)?;
    let seconds: u64 = flag(args, "--seconds").and_then(|s| s.parse().ok()).unwrap_or(0);
    let recorder = Recorder::open(config).map_err(|e| e.to_string())?;
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
        Some("transcribe") => cli_transcribe(&args[1..]),
        Some("record") => cli_record(&args[1..]),
        Some(other) => Err(format!("unknown command {other}")),
    };
    if let Err(message) = result {
        eprintln!("{message}");
        std::process::exit(1);
    }
}
