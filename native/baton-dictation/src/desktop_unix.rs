//! Focus and paste on macOS and Linux, through the tools each desktop already ships. The chord
//! tools and their arguments are Handy's (`src-tauri/src/clipboard.rs` at 7bfb2e2c, MIT, Copyright
//! (c) 2025 CJ Pais). Handy's macOS receipt-based paste needs an AppKit run loop, which a sidecar
//! has none of, so both platforms here put the old clipboard back after a fixed wait.
//! See docs/baton/VOICE.md for what each desktop can and cannot do.

use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use crate::keys::PasteMethod;

/// A desktop that will not say what has focus. It equals itself, so text still pastes; the check
/// that it lands in the window it was spoken for cannot run there.
pub const UNKNOWN_WINDOW: isize = -1;

/// shortcut: a fixed wait can lose to a slow target and only plain text comes back (an image on
/// the clipboard is lost), upgrade by giving the sidecar a run loop for Handy's receipt-based paste.
const RESTORE_AFTER: Duration = Duration::from_millis(1500);

fn output(program: &str, args: &[&str]) -> Option<String> {
    let done = Command::new(program).args(args).stderr(Stdio::null()).output().ok()?;
    done.status.success().then(|| String::from_utf8_lossy(&done.stdout).into_owned())
}

/// Stdout is not captured: wl-copy and xclip leave a server behind, which would hold a pipe open.
fn feed(program: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("{program}: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(text.as_bytes())
        .map_err(|e| format!("{program}: {e}"))?;
    let status = child.wait().map_err(|e| format!("{program}: {e}"))?;
    status.success().then_some(()).ok_or_else(|| format!("{program} failed"))
}

fn restore_later(old: Option<String>, ours: String, read: fn() -> Option<String>, write: fn(&str) -> Result<(), String>) {
    let Some(old) = old else { return };
    thread::spawn(move || {
        thread::sleep(RESTORE_AFTER);
        // If he copied something since, that wins.
        if read().as_deref() == Some(ours.as_str()) {
            let _ = write(&old);
        }
    });
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    /// `"pid"=123` and `"LSDisplayName"="Safari"`, from lsappinfo.
    pub(super) fn field<'a>(text: &'a str, key: &str) -> Option<&'a str> {
        let start = text.find(&format!("\"{key}\"="))? + key.len() + 3;
        let line = text[start..].lines().next()?.trim();
        Some(line.trim_matches('"'))
    }

    fn front() -> Option<String> {
        // NSWorkspace goes stale in a process with no run loop; lsappinfo asks the system each time.
        let asn = output("lsappinfo", &["front"])?;
        output("lsappinfo", &["info", "-only", "pid,name", asn.trim()])
    }

    /// The front app's pid. macOS gives no window without Screen Recording, so two windows of one
    /// app count as the same target.
    pub fn foreground_window() -> isize {
        front().and_then(|t| field(&t, "pid")?.parse().ok()).unwrap_or(UNKNOWN_WINDOW)
    }

    /// No title: that also needs Screen Recording, so a browser cannot be told apart by site.
    pub fn window_app(_window: isize) -> (String, String) {
        let name = front().and_then(|t| field(&t, "LSDisplayName").map(str::to_lowercase));
        (name.unwrap_or_default(), String::new())
    }

    fn read() -> Option<String> {
        output("pbpaste", &[])
    }

    fn write(text: &str) -> Result<(), String> {
        feed("pbcopy", &[], text)
    }

    pub fn paste(text: &str, method: PasteMethod, enigo: &mut enigo::Enigo) -> Result<(), String> {
        let old = read();
        write(text)?;
        crate::keys::send_chord(enigo, method)?;
        restore_later(old, text.to_string(), read, write);
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    fn wayland() -> bool {
        std::env::var_os("WAYLAND_DISPLAY").is_some()
    }

    fn has(program: &str) -> bool {
        Command::new("sh").args(["-c", &format!("command -v {program}")]).stdout(Stdio::null()).status().is_ok_and(|s| s.success())
    }

    fn hyprland() -> Option<serde_json::Value> {
        serde_json::from_str(&output("hyprctl", &["activewindow", "-j"])?).ok()
    }

    pub(super) fn focused_node(node: &serde_json::Value) -> Option<&serde_json::Value> {
        if node["focused"].as_bool() == Some(true) {
            return Some(node);
        }
        let children = node["nodes"].as_array().into_iter().flatten();
        children.chain(node["floating_nodes"].as_array().into_iter().flatten()).find_map(focused_node)
    }

    fn sway() -> Option<serde_json::Value> {
        let tree = serde_json::from_str(&output("swaymsg", &["-t", "get_tree"])?).ok()?;
        focused_node(&tree).cloned()
    }

    /// X11 answers for any window manager; on Wayland only compositors with their own CLI do.
    /// GNOME and KDE on Wayland will not tell an ordinary process.
    pub fn foreground_window() -> isize {
        if wayland() {
            let id = hyprland()
                .and_then(|w| i64::from_str_radix(w["address"].as_str()?.trim_start_matches("0x"), 16).ok())
                .or_else(|| sway()?["id"].as_i64());
            return id.map_or(UNKNOWN_WINDOW, |id| id as isize);
        }
        output("xdotool", &["getactivewindow"]).and_then(|t| t.trim().parse().ok()).unwrap_or(UNKNOWN_WINDOW)
    }

    pub fn window_app(window: isize) -> (String, String) {
        if wayland() {
            let text = |v: &serde_json::Value, k: &str| v[k].as_str().unwrap_or("").to_lowercase();
            if let Some(w) = hyprland() {
                return (text(&w, "class"), w["title"].as_str().unwrap_or("").to_string());
            }
            if let Some(w) = sway() {
                return (text(&w, "app_id"), w["name"].as_str().unwrap_or("").to_string());
            }
            return (String::new(), String::new());
        }
        if window == UNKNOWN_WINDOW {
            return (String::new(), String::new());
        }
        let id = window.to_string();
        let title = output("xdotool", &["getwindowname", &id]).unwrap_or_default();
        let exe = output("xdotool", &["getwindowpid", &id])
            .and_then(|pid| std::fs::read_to_string(format!("/proc/{}/comm", pid.trim())).ok())
            .unwrap_or_default();
        (exe.trim().to_lowercase(), title.trim().to_string())
    }

    fn read() -> Option<String> {
        if wayland() {
            output("wl-paste", &["--no-newline"])
        } else {
            output("xclip", &["-selection", "clipboard", "-o"]).or_else(|| output("xsel", &["--clipboard", "--output"]))
        }
    }

    fn write(text: &str) -> Result<(), String> {
        if wayland() {
            feed("wl-copy", &[], text)
        } else if has("xclip") {
            feed("xclip", &["-selection", "clipboard"], text)
        } else {
            feed("xsel", &["--clipboard", "--input"], text)
        }
    }

    pub(super) fn combo(method: PasteMethod) -> &'static str {
        match method {
            PasteMethod::CtrlV => "ctrl+v",
            PasteMethod::ShiftInsert => "shift+Insert",
            PasteMethod::CtrlShiftV => "ctrl+shift+v",
        }
    }

    fn wtype_args(method: PasteMethod) -> &'static [&'static str] {
        match method {
            PasteMethod::CtrlV => &["-M", "ctrl", "-k", "v", "-m", "ctrl"],
            PasteMethod::ShiftInsert => &["-M", "shift", "-k", "Insert", "-m", "shift"],
            PasteMethod::CtrlShiftV => &["-M", "ctrl", "-M", "shift", "-k", "v", "-m", "shift", "-m", "ctrl"],
        }
    }

    pub(super) fn ydotool_raw(method: PasteMethod) -> &'static [&'static str] {
        match method {
            PasteMethod::CtrlV => &["key", "29:1", "47:1", "47:0", "29:0"],
            PasteMethod::ShiftInsert => &["key", "42:1", "110:1", "110:0", "42:0"],
            PasteMethod::CtrlShiftV => &["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"],
        }
    }

    fn ran(program: &str, args: &[&str]) -> bool {
        output(program, args).is_some()
    }

    fn chord(method: PasteMethod) -> Result<(), String> {
        let keys = combo(method);
        // wtype needs a compositor with virtual-keyboard: wlroots, not GNOME, not most of KDE.
        // dotool and ydotool go through uinput, so they work anywhere that grants /dev/uinput.
        let sent = if wayland() {
            ran("wtype", wtype_args(method))
                || feed("dotool", &[], &format!("key {}\n", keys.to_lowercase())).is_ok()
                || ran("ydotool", ydotool_raw(method))
                || ran("ydotool", &["key", &keys.to_lowercase()])
        } else {
            ran("xdotool", &["key", "--clearmodifiers", keys])
                || feed("dotool", &[], &format!("key {}\n", keys.to_lowercase())).is_ok()
                || ran("ydotool", ydotool_raw(method))
        };
        sent.then_some(()).ok_or_else(|| {
            let tools = if wayland() { "wtype, dotool or ydotool" } else { "xdotool, dotool or ydotool" };
            format!("Nothing could send the paste key. Install {tools}.")
        })
    }

    pub fn paste(text: &str, method: PasteMethod) -> Result<(), String> {
        let old = read();
        write(text).map_err(|e| format!("Could not reach the clipboard ({e}). Install wl-clipboard or xclip."))?;
        // The dictation key's modifiers may still be down, and there is no portable way to ask.
        thread::sleep(Duration::from_millis(120));
        chord(method)?;
        restore_later(old, text.to_string(), read, write);
        Ok(())
    }
}

pub use platform::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_lsappinfo() {
        let text = "\"LSDisplayName\"=\"Visual Studio Code\"\n\"pid\"=4242\n";
        assert_eq!(platform::field(text, "pid"), Some("4242"));
        assert_eq!(platform::field(text, "LSDisplayName"), Some("Visual Studio Code"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn finds_the_focused_sway_window() {
        let tree = serde_json::json!({"focused": false, "nodes": [
            {"focused": false, "nodes": [], "floating_nodes": [{"focused": true, "id": 7, "nodes": []}]}
        ]});
        assert_eq!(platform::focused_node(&tree).unwrap()["id"], 7);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn chords_match_the_method() {
        assert_eq!(platform::combo(PasteMethod::CtrlShiftV), "ctrl+shift+v");
        assert_eq!(platform::ydotool_raw(PasteMethod::CtrlV), &["key", "29:1", "47:1", "47:0", "29:0"]);
    }
}
