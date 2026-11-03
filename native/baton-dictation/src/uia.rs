//! The real element behind a guess: Windows UI Automation, searched inside the top-level window
//! under the model's point. A pointer lands on something that exists or says it could not check.
use serde_json::{json, Value};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationElementArray, TreeScope_Descendants,
    UIA_BoundingRectanglePropertyId, UIA_HasKeyboardFocusPropertyId, UIA_IsOffscreenPropertyId,
    UIA_LocalizedControlTypePropertyId, UIA_NamePropertyId,
};
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, WindowFromPoint, GA_ROOT};

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

struct Snap {
    name: String,
    rect: RECT,
    offscreen: bool,
    kind: String,
    focused: bool,
}

/// One cross-process fetch per element (cached) or five (live). Offscreen is true when unreadable.
unsafe fn snap(element: &IUIAutomationElement, cached: bool) -> Snap {
    if cached {
        Snap {
            name: element.CachedName().map(|n| n.to_string()).unwrap_or_default(),
            rect: element.CachedBoundingRectangle().unwrap_or_default(),
            offscreen: element.CachedIsOffscreen().map(|o| o.as_bool()).unwrap_or(true),
            kind: element.CachedLocalizedControlType().map(|k| k.to_string()).unwrap_or_default(),
            focused: element.CachedHasKeyboardFocus().map(|f| f.as_bool()).unwrap_or(false),
        }
    } else {
        Snap {
            name: element.CurrentName().map(|n| n.to_string()).unwrap_or_default(),
            rect: element.CurrentBoundingRectangle().unwrap_or_default(),
            offscreen: element.CurrentIsOffscreen().map(|o| o.as_bool()).unwrap_or(true),
            kind: element.CurrentLocalizedControlType().map(|k| k.to_string()).unwrap_or_default(),
            focused: element.CurrentHasKeyboardFocus().map(|f| f.as_bool()).unwrap_or(false),
        }
    }
}

/// UFO reads every element's properties in one call (FindAllBuildCache); BATON_UIA_CACHE=0 is the old per-property path.
fn cache_on() -> bool {
    std::env::var("BATON_UIA_CACHE").map(|v| v != "0").unwrap_or(true)
}

unsafe fn descendants(automation: &IUIAutomation, root: &IUIAutomationElement, cached: bool) -> windows::core::Result<IUIAutomationElementArray> {
    let condition = automation.ControlViewCondition()?;
    if !cached {
        return root.FindAll(TreeScope_Descendants, &condition);
    }
    let request = automation.CreateCacheRequest()?;
    for property in [
        UIA_NamePropertyId,
        UIA_BoundingRectanglePropertyId,
        UIA_IsOffscreenPropertyId,
        UIA_LocalizedControlTypePropertyId,
        UIA_HasKeyboardFocusPropertyId,
    ] {
        request.AddProperty(property)?;
    }
    root.FindAllBuildCache(TreeScope_Descendants, &condition, &request)
}

struct Found {
    name: String,
    rect: RECT,
    element: IUIAutomationElement,
}

/// The element under the model's point, or an ancestor of it, when it carries the label.
unsafe fn at_point(automation: &IUIAutomation, label: &str, x: i32, y: i32) -> windows::core::Result<Option<Found>> {
    let walker = automation.ControlViewWalker()?;
    let mut element = automation.ElementFromPoint(POINT { x, y })?;
    for _ in 0..4 {
        let name = element.CurrentName().map(|n| n.to_string()).unwrap_or_default();
        let rect = element.CurrentBoundingRectangle().unwrap_or_default();
        if name_score(label, &name) > 0.0 && rect.right - rect.left >= MIN_SIDE && rect.bottom - rect.top >= MIN_SIDE {
            return Ok(Some(Found { name, rect, element }));
        }
        // The top of the tree answers with no element, which is simply the end of the walk.
        let Ok(parent) = walker.GetParentElement(&element) else { break };
        element = parent;
    }
    Ok(None)
}

/// The name of what is on top at the element's centre when that is not the element or inside it; None when a click
/// there reaches the element (or the hit test cannot tell, which counts as reachable).
unsafe fn covered_by(automation: &IUIAutomation, element: &IUIAutomationElement, rect: &RECT) -> Option<String> {
    let (cx, cy) = centre(rect);
    let walker = automation.ControlViewWalker().ok()?;
    let top = automation.ElementFromPoint(POINT { x: cx as i32, y: cy as i32 }).ok()?;
    let mut hit = top.clone();
    for _ in 0..8 {
        if automation.CompareElements(&hit, element).map(|b| b.as_bool()).unwrap_or(false) {
            return None;
        }
        let Ok(parent) = walker.GetParentElement(&hit) else { break };
        hit = parent;
    }
    let name = top.CurrentName().map(|n| n.to_string()).unwrap_or_default();
    Some(if name.is_empty() { "another window".to_string() } else { name })
}

/// Physical pixels in and out. `found: false` means the tree has no such element. `foreground`
/// searches the window with the keyboard, wherever the pointer is; otherwise the window under (x, y).
pub fn locate(label: &str, x: i32, y: i32, foreground: bool) -> Result<Value, String> {
    let err = |e: windows::core::Error| e.to_string();
    let cached = cache_on();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(err)?;
        let top = if foreground {
            GetForegroundWindow()
        } else {
            GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT)
        };
        // 0x80040201 can come from the window or any one provider in it, and fails the whole
        // search, so ask for the element at the point instead.
        let searched = automation
            .ElementFromHandle(top)
            .and_then(|root| descendants(&automation, &root, cached));
        let (found, count) = match searched {
            Ok(all) => {
                let count = all.Length().map_err(err)?.min(MAX_ELEMENTS);
                let mut best: Option<(f32, Found)> = None;
                for i in 0..count {
                    let Ok(element) = all.GetElement(i) else { continue };
                    let s = snap(&element, cached);
                    let score = name_score(label, &s.name);
                    if score == 0.0 || s.offscreen {
                        continue;
                    }
                    // A window's own 1 px title element has the right name and is nothing to point at.
                    if s.rect.right - s.rect.left < MIN_SIDE || s.rect.bottom - s.rect.top < MIN_SIDE {
                        continue;
                    }
                    let (cx, cy) = centre(&s.rect);
                    let distance = ((cx - x as f32).powi(2) + (cy - y as f32).powi(2)).sqrt();
                    // Name first; among equals the one nearest the model's point.
                    let rank = score * 10_000.0 - distance;
                    if best.as_ref().map(|(r, _)| rank > *r).unwrap_or(true) {
                        best = Some((rank, Found { name: s.name, rect: s.rect, element }));
                    }
                }
                (best.map(|(_, f)| f), count)
            }
            Err(whole) => (
                at_point(&automation, label, x, y)
                    .map_err(|inner| format!("{whole}; at the point: {inner}"))?,
                1,
            ),
        };
        Ok(match found {
            Some(f) => {
                let mut out = json!({
                    "found": true, "name": f.name, "elements": count,
                    "x": (f.rect.left + f.rect.right) / 2, "y": (f.rect.top + f.rect.bottom) / 2,
                    "width": f.rect.right - f.rect.left, "height": f.rect.bottom - f.rect.top,
                });
                if let Some(by) = covered_by(&automation, &f.element, &f.rect) {
                    out["covered_by"] = json!(by);
                }
                out
            }
            None => json!({"found": false, "elements": count}),
        })
    }
}

/// What the keyboard's window offers, by name and kind: the agent reads this before it takes a
/// screenshot, and clicks a line of it with `locate`. Names only, so no coordinates leave here.
pub fn tree(max: usize) -> Result<Value, String> {
    let err = |e: windows::core::Error| e.to_string();
    let cached = cache_on();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(err)?;
        let root = automation.ElementFromHandle(GetForegroundWindow()).map_err(err)?;
        let title = root.CurrentName().map(|n| n.to_string()).unwrap_or_default();
        let all = descendants(&automation, &root, cached).map_err(err)?;
        let count = all.Length().map_err(err)?.min(MAX_ELEMENTS);
        let mut lines: Vec<String> = Vec::new();
        for i in 0..count {
            if lines.len() >= max {
                break;
            }
            let Ok(element) = all.GetElement(i) else { continue };
            let s = snap(&element, cached);
            let name = s.name.trim();
            if name.is_empty() || s.offscreen {
                continue;
            }
            if s.rect.right - s.rect.left < MIN_SIDE || s.rect.bottom - s.rect.top < MIN_SIDE {
                continue;
            }
            let line = format!("{}: {}{}", s.kind, name.chars().take(80).collect::<String>(), if s.focused { " (focused)" } else { "" });
            if lines.last() != Some(&line) {
                lines.push(line);
            }
        }
        Ok(json!({"window": title, "controls": lines, "total": count}))
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
