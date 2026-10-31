//! The paste chord. Key codes and the 100 ms modifier hold are Handy's (`src-tauri/src/input.rs`):
//! some systems drop a chord released faster than that.
use enigo::{Direction, Enigo, Key, Keyboard};
use serde::Deserialize;
use std::{thread, time::Duration};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PasteMethod {
    #[default]
    CtrlV,
    ShiftInsert,
    CtrlShiftV,
}

const HOLD: Duration = Duration::from_millis(100);

#[cfg(windows)]
const V: Key = Key::Other(0x56);
#[cfg(not(windows))]
const V: Key = Key::Unicode('v');
#[cfg(windows)]
const INSERT: Key = Key::Other(0x2D);
#[cfg(not(windows))]
const INSERT: Key = Key::Other(0x76);

/// The dictation key's own modifiers may still be held; a Ctrl+Alt+V is not a paste.
#[cfg(windows)]
fn wait_for_modifiers_up() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};
    for _ in 0..100 {
        let down = [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
            .iter()
            .any(|key| unsafe { GetAsyncKeyState(key.0 as i32) } < 0);
        if !down {
            return;
        }
        thread::sleep(Duration::from_millis(15));
    }
}

#[cfg(not(windows))]
fn wait_for_modifiers_up() {}

pub fn send_chord(enigo: &mut Enigo, method: PasteMethod) -> Result<(), String> {
    wait_for_modifiers_up();
    let err = |e: enigo::InputError| format!("paste chord: {e}");
    let (modifiers, key): (&[Key], Key) = match method {
        PasteMethod::CtrlV => (&[Key::Control], V),
        PasteMethod::ShiftInsert => (&[Key::Shift], INSERT),
        PasteMethod::CtrlShiftV => (&[Key::Control, Key::Shift], V),
    };
    for m in modifiers {
        enigo.key(*m, Direction::Press).map_err(err)?;
    }
    enigo.key(key, Direction::Click).map_err(err)?;
    thread::sleep(HOLD);
    for m in modifiers.iter().rev() {
        enigo.key(*m, Direction::Release).map_err(err)?;
    }
    Ok(())
}
