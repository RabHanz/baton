//! A picture of one window by PrintWindow: it works for a window that is covered, behind others or on another
//! desktop area, and never brings it forward. Written as a 32-bit BMP file (the caller turns it into a PNG).
use serde_json::{json, Value};
use std::io::Write;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ, RGBQUAD,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};

/// PW_RENDERFULLCONTENT: also captures windows drawn by DirectComposition (modern apps, browsers).
const RENDER_FULL_CONTENT: u32 = 2;

/// `handle` names the window exactly (the one he was using when he spoke); else `window` by title; else the foreground.
pub fn capture_window(window: Option<&str>, handle: Option<isize>, out: &str) -> Result<Value, String> {
    unsafe {
        let hwnd: HWND = match (handle, window) {
            (Some(h), _) => HWND(h as *mut _),
            (None, Some(title)) => crate::uia::find_window(title).ok_or_else(|| format!("No window is titled like \"{title}\"."))?,
            (None, None) => GetForegroundWindow(),
        };
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).map_err(|e| e.to_string())?;
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        if w <= 0 || h <= 0 {
            return Err("The window has no size (is it minimised?).".into());
        }
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, HGDIOBJ(bitmap.0));
        let printed = PrintWindow(hwnd, mem, PRINT_WINDOW_FLAGS(RENDER_FULL_CONTENT)).as_bool();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            bmiColors: [RGBQUAD::default(); 1],
        };
        let mut pixels = vec![0u8; (w as usize) * (h as usize) * 4];
        let lines = GetDIBits(mem, bitmap, 0, h as u32, Some(pixels.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if !printed || lines == 0 {
            return Err("The window would not draw itself into a picture.".into());
        }
        let mut file = std::fs::File::create(out).map_err(|e| e.to_string())?;
        let header = info.bmiHeader;
        let size = 14 + 40 + pixels.len() as u32;
        let mut head = Vec::with_capacity(54);
        head.extend_from_slice(b"BM");
        head.extend_from_slice(&size.to_le_bytes());
        head.extend_from_slice(&[0, 0, 0, 0]);
        head.extend_from_slice(&54u32.to_le_bytes());
        head.extend_from_slice(&40u32.to_le_bytes());
        head.extend_from_slice(&header.biWidth.to_le_bytes());
        head.extend_from_slice(&header.biHeight.to_le_bytes());
        head.extend_from_slice(&1u16.to_le_bytes());
        head.extend_from_slice(&32u16.to_le_bytes());
        head.extend_from_slice(&[0u8; 24]);
        file.write_all(&head).and_then(|_| file.write_all(&pixels)).map_err(|e| e.to_string())?;
        Ok(json!({"path": out, "width": w, "height": h, "left": rect.left, "top": rect.top}))
    }
}

/// Gives the keyboard back to a window (after foreground input into another one). A minimised window is restored first.
pub fn focus_window(window: isize) -> Result<Value, String> {
    unsafe {
        let hwnd = HWND(window as *mut _);
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        if SetForegroundWindow(hwnd).as_bool() {
            Ok(json!({"focused": true}))
        } else {
            Err("Windows would not give that window the keyboard.".into())
        }
    }
}
