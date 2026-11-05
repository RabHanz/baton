//! A count of what changed on his desktop (a window came forward, a menu opened, focus or a value moved), from
//! WinEvents. A lesson that waits for his step checks the screen only after the count moves, instead of capturing
//! every display each second.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Once;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, EVENT_OBJECT_FOCUS, EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_OBJECT_VALUECHANGE,
    EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUPOPUPEND, MSG, OBJID_CARET, OBJID_CURSOR, OBJID_WINDOW,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

static CHANGES: AtomicU64 = AtomicU64::new(0);
static START: Once = Once::new();

/// Which events count: a caret or the pointer moving is not his step, and a name change counts only for a window
/// (a title such as "*Untitled"), not a ticking clock inside one.
pub fn counts(event: u32, object: i32) -> bool {
    if object == OBJID_CARET.0 || object == OBJID_CURSOR.0 {
        return false;
    }
    match event {
        EVENT_SYSTEM_FOREGROUND..=EVENT_SYSTEM_MENUPOPUPEND => true,
        EVENT_OBJECT_SHOW | EVENT_OBJECT_FOCUS | EVENT_OBJECT_VALUECHANGE => true,
        EVENT_OBJECT_NAMECHANGE => object == OBJID_WINDOW.0,
        _ => false,
    }
}

unsafe extern "system" fn on_event(_: HWINEVENTHOOK, event: u32, _: HWND, object: i32, _: i32, _: u32, _: u32) {
    if counts(event, object) {
        CHANGES.fetch_add(1, Ordering::Relaxed);
    }
}

/// The count so far; the first call starts the hook on its own thread, which pumps the messages it needs.
pub fn changes() -> u64 {
    START.call_once(|| {
        std::thread::spawn(|| unsafe {
            let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
            let _system = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUPOPUPEND, None, Some(on_event), 0, 0, flags);
            let _object = SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_VALUECHANGE, None, Some(on_event), 0, 0, flags);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        });
    });
    CHANGES.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::counts;
    use windows::Win32::UI::WindowsAndMessaging::{
        EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND, OBJID_CARET,
        OBJID_CLIENT, OBJID_WINDOW,
    };

    #[test]
    fn his_steps_count_and_a_caret_or_a_clock_does_not() {
        assert!(counts(EVENT_SYSTEM_FOREGROUND, OBJID_WINDOW.0));
        assert!(counts(EVENT_OBJECT_NAMECHANGE, OBJID_WINDOW.0));
        assert!(!counts(EVENT_OBJECT_NAMECHANGE, OBJID_CLIENT.0));
        assert!(!counts(EVENT_OBJECT_SHOW, OBJID_CARET.0));
        assert!(!counts(EVENT_OBJECT_LOCATIONCHANGE, OBJID_WINDOW.0));
    }
}
