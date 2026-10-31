//! Reliable clipboard paste on Windows. Adapted from Handy (MIT, Copyright (c) 2025 CJ Pais),
//! `src-tauri/src/paste_tx/{mod,windows}.rs` at 7bfb2e2c: the transcript goes on the clipboard as
//! a delayed-render format, so the target's read is a receipt, and the old clipboard comes back
//! only once reads go quiet and only if nobody copied something newer. Auto-submit and Tauri are
//! removed; everything else is theirs. Full notice: docs/baton/THIRD_PARTY_NOTICES.md.

use std::sync::{mpsc::Sender, Arc, Mutex, Once};
use std::thread;
use std::time::{Duration, Instant};

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{
    GlobalFree, SetLastError, ERROR_SUCCESS, HANDLE, HGLOBAL, HINSTANCE, HWND, LPARAM, LRESULT,
    WPARAM,
};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardOwner,
    GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Ole::{
    CF_BITMAP, CF_DSPBITMAP, CF_DSPENHMETAFILE, CF_DSPMETAFILEPICT, CF_DSPTEXT, CF_ENHMETAFILE,
    CF_OWNERDISPLAY, CF_PALETTE, CF_UNICODETEXT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CopyImage, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    GetWindowLongPtrW, KillTimer, PostQuitMessage, RegisterClassW, SetTimer, SetWindowLongPtrW,
    GDI_IMAGE_TYPE, GWLP_USERDATA, HWND_MESSAGE, IMAGE_FLAGS, MSG, WINDOW_EX_STYLE, WINDOW_STYLE,
    WM_DESTROYCLIPBOARD, WM_RENDERALLFORMATS, WM_RENDERFORMAT, WM_TIMER, WNDCLASSW,
};

use crate::keys::{send_chord, PasteMethod};

fn log(message: &str) {
    eprintln!("{message}");
}

/// How long after the *last* observed read the transcript stays on the
/// clipboard before restoring. Covers applications that read the clipboard
/// several times per paste (e.g. Chromium probe-then-read).
const QUIET_PERIOD: Duration = Duration::from_millis(200);

/// Upper bound on how long the transcript may occupy the clipboard before we
/// restore regardless of receipts. Long enough that a realistically loaded
/// target always gets to read first; short enough that a lost keystroke does
/// not strand the transcript on the clipboard for long.
const RESTORE_TIMEOUT: Duration = Duration::from_secs(8);

/// When the chord could not be injected at all, no legitimate receipt can
/// arrive, so restore quickly instead of waiting out the full timeout.
const FAILED_INJECTION_TIMEOUT: Duration = Duration::from_millis(500);

/// Shared, cross-thread record of one paste transaction.
#[derive(Debug)]
struct TxState {
    /// When the transcript was published to the clipboard.
    pub published_at: Instant,
    /// When the paste chord was injected. Only receipts *after* this count as
    /// evidence the target read the transcript — earlier reads are eager third
    /// parties reacting to the clipboard change itself.
    pub injected_at: Option<Instant>,
    /// The chord could not be sent; short-circuit the wait.
    pub injection_failed: bool,
    /// Times at which a consumer requested the clipboard data.
    pub receipts: Vec<Instant>,
    /// Someone else took clipboard ownership (user copied elsewhere, ...).
    pub ownership_lost: bool,
    /// A newer paste transaction settled this one early (see flush logic in
    /// the platform modules).
    pub cancelled: bool,
    /// First post-injection receipt has been logged.
    pub logged_receipt: bool,
}

impl TxState {
    pub fn new() -> Self {
        Self {
            published_at: Instant::now(),
            injected_at: None,
            injection_failed: false,
            receipts: Vec::new(),
            ownership_lost: false,
            cancelled: false,
            logged_receipt: false,
        }
    }

    /// Records a read receipt, logging the first one that counts as evidence.
    pub fn record_receipt(&mut self, at: Instant) {
        self.receipts.push(at);
        if !self.logged_receipt {
            if let Some(injected) = self.injected_at {
                if at >= injected {
                    self.logged_receipt = true;
                    log(&format!(
                        "[reliable-paste] clipboard read {}ms after chord",
                        at.duration_since(injected).as_millis()
                    ));
                }
            }
        }
    }

    pub fn last_receipt_after_injection(&self) -> Option<Instant> {
        let injected = self.injected_at?;
        self.receipts.iter().copied().rev().find(|t| *t >= injected)
    }

    pub fn any_receipt_after_injection(&self) -> bool {
        self.last_receipt_after_injection().is_some()
    }
}

enum WaitDecision {
    KeepWaiting,
    /// Stop waiting; settle the transaction (auto-submit + guarded restore).
    Finish,
}

/// Pure decision: given the current transaction state, keep waiting for the
/// target to read, or finish now. Both platform event loops call this.
fn evaluate(state: &TxState, now: Instant) -> WaitDecision {
    if state.ownership_lost || state.cancelled {
        return WaitDecision::Finish;
    }
    if let Some(last) = state.last_receipt_after_injection() {
        if now.duration_since(last) >= QUIET_PERIOD {
            return WaitDecision::Finish;
        }
    }
    let deadline = if state.injection_failed {
        FAILED_INJECTION_TIMEOUT
    } else {
        RESTORE_TIMEOUT
    };
    if now.duration_since(state.published_at) >= deadline {
        return WaitDecision::Finish;
    }
    WaitDecision::KeepWaiting
}

const CLASS_NAME: PCWSTR = w!("BatonPasteTxWindow");
const TIMER_ID: usize = 1;
const TIMER_INTERVAL_MS: u32 = 25;
/// Skip clipboard formats larger than this when snapshotting.
const MAX_FORMAT_BYTES: usize = 64 * 1024 * 1024;

const IMAGE_BITMAP_TYPE: GDI_IMAGE_TYPE = GDI_IMAGE_TYPE(0);
const LR_CREATEDIBSECTION_FLAG: IMAGE_FLAGS = IMAGE_FLAGS(0x2000);

struct SavedFormat {
    format: u32,
    data: Vec<u8>,
}

pub(super) struct WinTxShared {
    state: Mutex<TxState>,
    text: String,
    snapshot: Mutex<Vec<SavedFormat>>,
    /// Copied HBITMAP (as raw usize), restored via SetClipboardData.
    saved_bitmap: Mutex<Option<usize>>,
    sequence: Mutex<u32>,
}

/// The transaction currently holding the clipboard, if any. A new
/// transaction settles it before snapshotting (see `flush_pending`).
static PENDING: Mutex<Option<Arc<WinTxShared>>> = Mutex::new(None);

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn shared_ptr(hwnd: HWND) -> *const WinTxShared {
    GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const WinTxShared
}

/// Clipboard managers and history hold it for moments at a time, so one refusal is not a failure.
unsafe fn open_clipboard(hwnd: HWND) -> Result<(), String> {
    let mut last = None;
    for _ in 0..20 {
        match OpenClipboard(Some(hwnd)) {
            Ok(()) => return Ok(()),
            Err(error) => last = Some(error),
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Err(format!("OpenClipboard failed: {}", last.map(|e| e.to_string()).unwrap_or_default()))
}

/// Renders the promised transcript into the clipboard, which must already be
/// open: the system opens it on our behalf for WM_RENDERFORMAT; every other
/// caller has to wrap this in OpenClipboard/CloseClipboard itself.
unsafe fn render_text(shared: &WinTxShared) {
    let wide_text: Vec<u16> = shared
        .text
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let Ok(hg) = GlobalAlloc(GMEM_MOVEABLE, wide_text.len() * 2) else {
        return;
    };
    let ptr = GlobalLock(hg) as *mut u16;
    if ptr.is_null() {
        let _ = GlobalFree(Some(hg));
        return;
    }
    std::ptr::copy_nonoverlapping(wide_text.as_ptr(), ptr, wide_text.len());
    let _ = GlobalUnlock(hg);
    if SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(hg.0))).is_err() {
        let _ = GlobalFree(Some(hg));
    }
}

unsafe extern "system" fn paste_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let shared = shared_ptr(hwnd);
    match msg {
        WM_RENDERFORMAT => {
            if !shared.is_null() {
                let shared = &*shared;
                if let Ok(mut st) = shared.state.lock() {
                    st.record_receipt(Instant::now());
                }
                if wparam.0 as u32 == CF_UNICODETEXT.0 as u32 {
                    render_text(shared);
                }
            }
            LRESULT(0)
        }
        WM_RENDERALLFORMATS => {
            // Sent when the window is destroyed while an unrendered promise is
            // still on the clipboard — not a consumer read, so no receipt.
            // Unlike WM_RENDERFORMAT the system does not open the clipboard on
            // our behalf here: open it and confirm we still own it first.
            if !shared.is_null() {
                let shared = &*shared;
                if OpenClipboard(Some(hwnd)).is_ok() {
                    if GetClipboardOwner()
                        .map(|owner| owner == hwnd)
                        .unwrap_or(false)
                    {
                        render_text(shared);
                    }
                    let _ = CloseClipboard();
                }
            }
            LRESULT(0)
        }
        WM_DESTROYCLIPBOARD => {
            if !shared.is_null() {
                if let Ok(mut st) = (&*shared).state.lock() {
                    st.ownership_lost = true;
                }
            }
            LRESULT(0)
        }
        WM_TIMER => {
            if !shared.is_null() {
                on_timer(hwnd, &*shared);
            }
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn ensure_window_class(hinstance: HINSTANCE) {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let wc = WNDCLASSW {
            lpfnWndProc: Some(paste_wnd_proc),
            hInstance: hinstance,
            lpszClassName: CLASS_NAME,
            ..Default::default()
        };
        unsafe {
            RegisterClassW(&wc);
        }
    });
}

/// If a previous transaction is still holding the clipboard, settle it now so
/// the snapshot below captures the user's original clipboard content. The
/// previous worker observes `cancelled` on its next timer tick and tears down
/// without restoring.
fn flush_pending() {
    let previous = match PENDING.lock() {
        Ok(mut slot) => slot.take(),
        Err(_) => None,
    };
    let Some(previous) = previous else {
        return;
    };
    match previous.state.lock() {
        Ok(mut st) => st.cancelled = true,
        Err(_) => return,
    }
    let sequence = *previous.sequence.lock().unwrap();
    let still_ours = unsafe { GetClipboardSequenceNumber() } == sequence;
    if still_ours {
        unsafe { restore_snapshot(&previous) };
    }
}

/// Restores the snapshotted clipboard contents. Safe to call from any thread.
/// Nothing read the transcript: it stays on the clipboard, and the app is told, so it is not lost.
unsafe fn leave_transcript(shared: &WinTxShared) {
    if OpenClipboard(None).is_ok() {
        let _ = EmptyClipboard();
        render_text(shared);
        let _ = CloseClipboard();
    }
}

unsafe fn restore_snapshot(shared: &WinTxShared) {
    if OpenClipboard(None).is_err() {
        log(&format!("paste: could not open clipboard to restore"));
        return;
    }
    let _ = EmptyClipboard();
    if let Ok(formats) = shared.snapshot.lock() {
        for saved in formats.iter() {
            if saved.data.is_empty() {
                continue;
            }
            let Ok(hg) = GlobalAlloc(GMEM_MOVEABLE, saved.data.len()) else {
                continue;
            };
            let ptr = GlobalLock(hg) as *mut u8;
            if ptr.is_null() {
                let _ = GlobalFree(Some(hg));
                continue;
            }
            std::ptr::copy_nonoverlapping(saved.data.as_ptr(), ptr, saved.data.len());
            let _ = GlobalUnlock(hg);
            // SetClipboardData takes ownership of the handle on success.
            if SetClipboardData(saved.format, Some(HANDLE(hg.0))).is_err() {
                let _ = GlobalFree(Some(hg));
            }
        }
    }
    if let Ok(mut bitmap) = shared.saved_bitmap.lock() {
        if let Some(raw) = bitmap.take() {
            let _ = SetClipboardData(CF_BITMAP.0 as u32, Some(HANDLE(raw as *mut _)));
        }
    }
    let _ = CloseClipboard();
    log(&format!("paste: restored previous clipboard"));
}

unsafe fn snapshot_clipboard(hwnd: HWND, shared: &WinTxShared) -> Result<(), String> {
    open_clipboard(hwnd)?;
    let mut formats = Vec::new();
    let mut format = 0u32;
    loop {
        format = EnumClipboardFormats(format);
        if format == 0 {
            break;
        }
        if format == CF_BITMAP.0 as u32 {
            // GDI object, not global memory: duplicate the handle instead.
            if let Ok(handle) = GetClipboardData(CF_BITMAP.0 as u32) {
                if let Ok(copy) =
                    CopyImage(handle, IMAGE_BITMAP_TYPE, 0, 0, LR_CREATEDIBSECTION_FLAG)
                {
                    if let Ok(mut slot) = shared.saved_bitmap.lock() {
                        *slot = Some(copy.0 as usize);
                    }
                }
            }
            continue;
        }
        // Formats whose handles are not plain global memory cannot be
        // byte-copied; skipping them matches what the legacy path restored.
        if format == CF_ENHMETAFILE.0 as u32
            || format == CF_DSPENHMETAFILE.0 as u32
            || format == CF_DSPBITMAP.0 as u32
            || format == CF_DSPMETAFILEPICT.0 as u32
            || format == CF_DSPTEXT.0 as u32
            || format == CF_OWNERDISPLAY.0 as u32
            || format == CF_PALETTE.0 as u32
        {
            continue;
        }
        if let Ok(handle) = GetClipboardData(format) {
            let hg = HGLOBAL(handle.0);
            let size = GlobalSize(hg);
            if size == 0 || size > MAX_FORMAT_BYTES {
                continue;
            }
            let ptr = GlobalLock(hg) as *const u8;
            if ptr.is_null() {
                continue;
            }
            let data = std::slice::from_raw_parts(ptr, size).to_vec();
            let _ = GlobalUnlock(hg);
            formats.push(SavedFormat { format, data });
        }
    }
    let _ = CloseClipboard();
    if let Ok(mut slot) = shared.snapshot.lock() {
        *slot = formats;
    }
    Ok(())
}

/// Publishes the transcript as a delayed-render promise plus clipboard
/// history / cloud / monitoring opt-out markers (the same formats Chrome uses
/// for Incognito copies). Returns the new clipboard sequence number.
unsafe fn publish(hwnd: HWND) -> Result<u32, String> {
    open_clipboard(hwnd)?;
    let published = publish_formats();
    let closed = CloseClipboard();
    published?;
    closed.map_err(|e| format!("CloseClipboard failed: {e}"))?;
    Ok(GetClipboardSequenceNumber())
}

/// Everything `publish` does while the clipboard is open, split out so
/// `publish` closes the clipboard on every path — bailing out while holding it
/// open (and possibly already emptied) would strand the clipboard and leave
/// the legacy fallback snapshotting nothing.
unsafe fn publish_formats() -> Result<(), String> {
    EmptyClipboard().map_err(|e| format!("EmptyClipboard failed: {e}"))?;

    for (name, value) in [
        ("ExcludeClipboardContentFromMonitorProcessing", 1u32),
        ("CanIncludeInClipboardHistory", 0u32),
        ("CanUploadToCloudClipboard", 0u32),
    ] {
        let name_wide = wide(name);
        let format = RegisterClipboardFormatW(PCWSTR(name_wide.as_ptr()));
        if format == 0 {
            continue;
        }
        if let Ok(hg) = GlobalAlloc(GMEM_MOVEABLE, std::mem::size_of::<u32>()) {
            let ptr = GlobalLock(hg) as *mut u32;
            if !ptr.is_null() {
                *ptr = value;
                let _ = GlobalUnlock(hg);
                if SetClipboardData(format, Some(HANDLE(hg.0))).is_err() {
                    let _ = GlobalFree(Some(hg));
                }
            } else {
                let _ = GlobalFree(Some(hg));
            }
        }
    }

    // NULL handle = delayed rendering: we are only asked for the data (via
    // WM_RENDERFORMAT) when a consumer actually reads it. SetClipboardData
    // returns the handle it was given, so for delayed rendering success is
    // also NULL and the windows crate reports it as an Err carrying
    // GetLastError(). Only a nonzero thread error is a real failure, and the
    // thread error must be cleared first so a stale value from an earlier
    // call can't masquerade as one.
    SetLastError(ERROR_SUCCESS);
    if let Err(e) = SetClipboardData(CF_UNICODETEXT.0 as u32, None) {
        if e.code().is_err() {
            return Err(format!("SetClipboardData failed: {e}"));
        }
    }
    Ok(())
}

fn on_timer(_hwnd: HWND, shared: &WinTxShared) {
    let now = Instant::now();
    let finish = {
        let mut st = match shared.state.lock() {
            Ok(st) => st,
            Err(_) => return,
        };
        if st.cancelled {
            true
        } else {
            match evaluate(&st, now) {
                WaitDecision::KeepWaiting => false,
                WaitDecision::Finish => {
                    st.cancelled = true;
                    true
                }
            }
        }
    };
    if !finish {
        return;
    }

    let (receipt, ownership_lost, injection_failed) = {
        let st = match shared.state.lock() {
            Ok(st) => st,
            Err(_) => return,
        };
        (
            st.any_receipt_after_injection(),
            st.ownership_lost,
            st.injection_failed,
        )
    };
    if ownership_lost {
        log(&format!("paste: settling: clipboard ownership lost"));
    } else if receipt {
        log(&format!("paste: settling: reads went quiet"));
    } else if injection_failed {
        log(&format!("paste: settling: chord injection failed, restoring quickly"));
    } else {
        log(&format!("paste: settling: no read within timeout, restoring anyway"));
    }

    let sequence = *shared.sequence.lock().unwrap();
    let still_ours = !ownership_lost && unsafe { GetClipboardSequenceNumber() } == sequence;
    if still_ours {
        if receipt {
            unsafe { restore_snapshot(shared) };
        } else {
            unsafe { leave_transcript(shared) };
        }
    } else {
        log(&format!("paste: clipboard changed externally; leaving it untouched"));
    }
    if !receipt {
        crate::emit(serde_json::json!({"ev": "unread", "text": shared.text}));
    }

    if let Ok(mut slot) = PENDING.lock() {
        let is_us = slot
            .as_ref()
            .map(|pending| Arc::as_ptr(pending) as *const WinTxShared == shared as *const _)
            .unwrap_or(false);
        if is_us {
            *slot = None;
        }
    }

    unsafe {
        PostQuitMessage(0);
    }
}

unsafe fn destroy_window_and_shared(hwnd: HWND) {
    let ptr = shared_ptr(hwnd);
    let _ = DestroyWindow(hwnd);
    if !ptr.is_null() {
        drop(Arc::from_raw(ptr));
    }
}

fn pump_thread(shared: Arc<WinTxShared>, ready: Sender<Result<(), String>>) {
    unsafe {
        // Settle any previous transaction first so the snapshot captures the
        // user's original clipboard, not the previous transcript.
        flush_pending();

        let hinstance = match GetModuleHandleW(PCWSTR::null()) {
            Ok(hmodule) => HINSTANCE(hmodule.0),
            Err(e) => {
                let _ = ready.send(Err(format!("GetModuleHandle failed: {e}")));
                return;
            }
        };
        ensure_window_class(hinstance);

        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            CLASS_NAME,
            w!("BatonPasteTx"),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(hinstance),
            None,
        ) {
            Ok(hwnd) => hwnd,
            Err(e) => {
                let _ = ready.send(Err(format!("CreateWindowEx failed: {e}")));
                return;
            }
        };
        SetWindowLongPtrW(
            hwnd,
            GWLP_USERDATA,
            Arc::into_raw(shared.clone()) as *const _ as isize,
        );

        let published = match snapshot_clipboard(hwnd, &shared) {
            Ok(()) => match publish(hwnd) {
                Ok(sequence) => Ok(sequence),
                Err(e) => {
                    // publish may have emptied the clipboard before failing;
                    // put the snapshot back so the legacy fallback's own
                    // snapshot captures the user's clipboard, not an empty one.
                    restore_snapshot(&shared);
                    Err(e)
                }
            },
            Err(e) => Err(e),
        };
        let sequence = match published {
            Ok(sequence) => sequence,
            Err(e) => {
                destroy_window_and_shared(hwnd);
                let _ = ready.send(Err(e));
                return;
            }
        };
        *shared.sequence.lock().unwrap() = sequence;
        shared.state.lock().unwrap().published_at = Instant::now();
        if let Ok(mut slot) = PENDING.lock() {
            *slot = Some(shared.clone());
        }
        let _ = SetTimer(Some(hwnd), TIMER_ID, TIMER_INTERVAL_MS, None);
        let _ = ready.send(Ok(()));

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = DispatchMessageW(&msg);
        }

        let _ = KillTimer(Some(hwnd), TIMER_ID);
        destroy_window_and_shared(hwnd);
    }
}

pub fn run(
    text: &str,
    paste_method: PasteMethod,
    enigo: &mut enigo::Enigo,
) -> Result<(), String> {
    let shared = Arc::new(WinTxShared {
        state: Mutex::new(TxState::new()),
        text: text.to_string(),
        snapshot: Mutex::new(Vec::new()),
        saved_bitmap: Mutex::new(None),
        sequence: Mutex::new(0),
    });

    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let shared_for_pump = shared.clone();
    thread::spawn(move || pump_thread(shared_for_pump, ready_tx));

    // Wait until the transcript is actually published (or the worker reports
    // why it could not) before injecting the chord.
    match ready_rx.recv() {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("reliable paste worker died before publishing".to_string()),
    }
    log(&format!("paste: published transcript (delayed render)"));

    // Mark injection *before* sending: enigo holds the chord for ~100ms and a
    // fast target may legitimately read while the chord is still held.
    shared.state.lock().unwrap().injected_at = Some(Instant::now());
    match send_chord(enigo, paste_method) {
        Ok(()) => {
            log(&format!("paste: paste chord sent ({paste_method:?})"));
        }
        Err(e) => {
            // Keep the transaction alive: the worker restores the clipboard
            // after the short failed-injection timeout.
            shared.state.lock().unwrap().injection_failed = true;
            log(&format!("paste: failed to send paste chord: {e}"));
        }
    }

    Ok(())
}
