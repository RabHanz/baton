//! The real element behind a guess: Windows UI Automation, searched inside the top-level window
//! under the model's point. A pointer lands on something that exists or says it could not check.
use serde_json::{json, Value};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, TreeScope_Descendants};
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetWindowRect, WindowFromPoint, GA_ROOT};

const MAX_ELEMENTS: i32 = 4000;
const MIN_SIDE: i32 = 8;

/// Lowercase words, so "Export..." and "export" are the same name.
fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// How well an element's name fits the label: every label word present scores by how little else
/// the name holds. Zero is no match.
pub fn name_score(label: &str, name: &str) -> f32 {
    let wanted = tokens(label);
    let have = tokens(name);
    if wanted.is_empty() || have.is_empty() || !wanted.iter().all(|w| have.contains(w)) {
        return 0.0;
    }
    wanted.len() as f32 / have.len() as f32
}

fn centre(rect: &RECT) -> (f32, f32) {
    ((rect.left + rect.right) as f32 / 2.0, (rect.top + rect.bottom) as f32 / 2.0)
}

/// The element under the model's point, or an ancestor of it, when it carries the label.
unsafe fn at_point(automation: &IUIAutomation, label: &str, x: i32, y: i32) -> windows::core::Result<Value> {
    let walker = automation.ControlViewWalker()?;
    let mut element = automation.ElementFromPoint(POINT { x, y })?;
    for _ in 0..4 {
        let name = element.CurrentName().map(|n| n.to_string()).unwrap_or_default();
        let rect = element.CurrentBoundingRectangle().unwrap_or_default();
        if name_score(label, &name) > 0.0 && rect.right - rect.left >= MIN_SIDE && rect.bottom - rect.top >= MIN_SIDE {
            return Ok(json!({
                "found": true, "name": name, "elements": 1,
                "x": (rect.left + rect.right) / 2, "y": (rect.top + rect.bottom) / 2,
                "width": rect.right - rect.left, "height": rect.bottom - rect.top,
            }));
        }
        element = walker.GetParentElement(&element)?;
    }
    Ok(json!({"found": false, "elements": 1}))
}

/// Physical pixels in and out. `found: false` means the tree has no such element.
pub fn locate(label: &str, x: i32, y: i32) -> Result<Value, String> {
    let err = |e: windows::core::Error| e.to_string();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(err)?;
        let top = GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT);
        let condition = automation.ControlViewCondition().map_err(err)?;
        // 0x80040201 can come from the window or any one provider in it, and fails the whole
        // search, so ask for the element at the point instead.
        let searched = automation
            .ElementFromHandle(top)
            .and_then(|root| root.FindAll(TreeScope_Descendants, &condition));
        let all = match searched {
            Ok(all) => all,
            Err(whole) => {
                return at_point(&automation, label, x, y)
                    .map_err(|inner| format!("{whole}; at the point: {inner}"))
            }
        };
        let count = all.Length().map_err(err)?.min(MAX_ELEMENTS);
        let mut best: Option<(f32, String, RECT)> = None;
        for i in 0..count {
            let Ok(element) = all.GetElement(i) else { continue };
            let Ok(name) = element.CurrentName() else { continue };
            let name = name.to_string();
            let score = name_score(label, &name);
            if score == 0.0 || element.CurrentIsOffscreen().map(|o| o.as_bool()).unwrap_or(true) {
                continue;
            }
            let Ok(rect) = element.CurrentBoundingRectangle() else { continue };
            // A window's own 1 px title element has the right name and is nothing to point at.
            if rect.right - rect.left < MIN_SIDE || rect.bottom - rect.top < MIN_SIDE {
                continue;
            }
            let (cx, cy) = centre(&rect);
            let distance = ((cx - x as f32).powi(2) + (cy - y as f32).powi(2)).sqrt();
            // Name first; among equals the one nearest the model's point.
            let rank = score * 10_000.0 - distance;
            if best.as_ref().map(|(r, ..)| rank > *r).unwrap_or(true) {
                best = Some((rank, name, rect));
            }
        }
        let mut window = RECT::default();
        let _ = GetWindowRect(top, &mut window);
        Ok(match best {
            Some((_, name, r)) => json!({
                "found": true, "name": name, "elements": count,
                "x": (r.left + r.right) / 2, "y": (r.top + r.bottom) / 2,
                "width": r.right - r.left, "height": r.bottom - r.top,
            }),
            None => json!({"found": false, "elements": count}),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::name_score;

    #[test]
    fn matches_whole_words_and_prefers_the_tighter_name() {
        assert_eq!(name_score("export", "Important"), 0.0);
        assert!(name_score("export", "Export") > name_score("export", "Export as PDF"));
        assert!(name_score("Export button", "Export") == 0.0);
    }
}
