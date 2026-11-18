use crate::models::WindowBounds;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

/// Applies WS_EX_TOOLWINDOW style on Windows to hide from taskbar and Alt+Tab
/// while keeping the window functional as a widget.
#[cfg(target_os = "windows")]
pub fn apply_tool_window_style(window: &WebviewWindow) -> Result<(), String> {
    if let Ok(hwnd) = window.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOOLWINDOW, WS_EX_APPWINDOW,
        };
        unsafe {
            let hwnd_ptr = hwnd.0 as _;
            let mut ex_style = GetWindowLongPtrW(hwnd_ptr, GWL_EXSTYLE);
            // Add WS_EX_TOOLWINDOW (hides from Alt+Tab and taskbar)
            // Remove WS_EX_APPWINDOW (ensures it doesn't show in taskbar)
            ex_style |= WS_EX_TOOLWINDOW as isize;
            ex_style &= !(WS_EX_APPWINDOW as isize);
            SetWindowLongPtrW(hwnd_ptr, GWL_EXSTYLE, ex_style);
        }
        Ok(())
    } else {
        Err("Failed to get window handle".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn apply_tool_window_style(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Sets the window owner to Progman (Program Manager) so the widget stays on the desktop
/// and does NOT minimize when user presses Win+D (Show Desktop).
/// This is the same technique used by Rainmeter and other desktop widgets.
#[cfg(target_os = "windows")]
pub fn set_desktop_widget_parent(window: &WebviewWindow) -> Result<(), String> {
    if let Ok(hwnd) = window.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, SetWindowLongPtrW, GWLP_HWNDPARENT,
        };
        unsafe {
            let hwnd_ptr = hwnd.0 as _;
            // Find Progman window (class name "Progman") - this is the desktop window that hosts SHELLDLL_DefView
            let progman_name: Vec<u16> = "Progman\0".encode_utf16().collect();
            let progman = FindWindowW(progman_name.as_ptr(), std::ptr::null());
            if !progman.is_null() {
                // Set the owner to Progman so this window becomes a "desktop widget"
                // This prevents Win+D from minimizing it
                SetWindowLongPtrW(hwnd_ptr, GWLP_HWNDPARENT, progman as _);
            }
        }
        Ok(())
    } else {
        Err("Failed to get window handle".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_desktop_widget_parent(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Applies native Windows backdrop blur/acrylic/mica with graceful fallback if unsupported.
pub fn apply_native_glass_effect(
    window: &WebviewWindow,
    effect_name: &str,
    dark_mode: bool,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{
            apply_acrylic, apply_blur, apply_mica, clear_acrylic, clear_blur, clear_mica,
        };

        let _ = clear_mica(window);
        let _ = clear_acrylic(window);
        let _ = clear_blur(window);

        match effect_name {
            "mica" => {
                if apply_mica(window, Some(dark_mode)).is_ok() {
                    return Ok("mica".to_string());
                }
                if apply_acrylic(
                    window,
                    Some(if dark_mode {
                        (18, 22, 34, 185)
                    } else {
                        (245, 248, 255, 195)
                    }),
                )
                .is_ok()
                {
                    return Ok("acrylic_fallback".to_string());
                }
            }
            "acrylic" => {
                let tint = if dark_mode {
                    (22, 23, 27, 80)
                } else {
                    (245, 247, 252, 190)
                };
                if apply_acrylic(window, Some(tint)).is_ok() {
                    return Ok("acrylic".to_string());
                }
                if apply_blur(window, Some(tint)).is_ok() {
                    return Ok("blur_fallback".to_string());
                }
            }
            "blur" => {
                let tint = if dark_mode {
                    (16, 20, 32, 180)
                } else {
                    (245, 247, 252, 195)
                };
                if apply_blur(window, Some(tint)).is_ok() {
                    return Ok("blur".to_string());
                }
            }
            _ => {}
        }
        Ok("css_translucent_fallback".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, effect_name, dark_mode);
        Ok("css_translucent_fallback".to_string())
    }
}

/// Restores saved window position and size while ensuring the window is visible on at least one active monitor.
/// Protects against disconnected external monitors or DPI changes pushing the widget off-screen.
pub fn restore_window_bounds_safely(window: &WebviewWindow, bounds: &WindowBounds) {
    let width = bounds.width.clamp(320, 1400);
    let height = bounds.height.clamp(380, 1600);
    let _ = window.set_size(PhysicalSize::new(width, height));

    let mut is_on_any_monitor = false;
    if let Ok(monitors) = window.available_monitors() {
        for m in &monitors {
            let m_pos = m.position();
            let m_size = m.size();
            let right = m_pos.x + m_size.width as i32;
            let bottom = m_pos.y + m_size.height as i32;

            // Check if at least 120x80 px of the widget header is reachable inside this monitor
            if bounds.x + 120 > m_pos.x
                && bounds.x < right - 60
                && bounds.y >= m_pos.y
                && bounds.y < bottom - 80
            {
                is_on_any_monitor = true;
                break;
            }
        }
    }

    if is_on_any_monitor {
        let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
    } else if let Ok(Some(primary)) = window.primary_monitor() {
        let p_pos = primary.position();
        let p_size = primary.size();
        let safe_x = p_pos.x + (p_size.width as i32 - width as i32 - 48).max(40);
        let safe_y = p_pos.y + 72;
        let _ = window.set_position(PhysicalPosition::new(safe_x, safe_y));
    }
}

/// Optional experimental Desktop-Pinned mode (places window at HWND_BOTTOM so normal app windows stay above it,
/// while avoiding Show-Desktop minimization where supported).
pub fn set_window_mode(window: &WebviewWindow, mode: &str) -> Result<String, String> {
    match mode {
        "always_on_top" => {
            window
                .set_always_on_top(true)
                .map_err(|e| format!("Gagal mengatur always-on-top: {}", e))?;
            Ok("always_on_top".to_string())
        }
        "desktop_pinned" => {
            let _ = window.set_always_on_top(false);
            #[cfg(target_os = "windows")]
            {
                // Place at HWND_BOTTOM on Windows so standard windows remain above the widget
                if let Ok(hwnd) = window.hwnd() {
                    use windows_sys::Win32::UI::WindowsAndMessaging::{
                        SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
                    };
                    unsafe {
                        SetWindowPos(
                            hwnd.0 as _,
                            HWND_BOTTOM,
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                    }
                }
            }
            Ok("desktop_pinned".to_string())
        }
        _ => {
            window
                .set_always_on_top(false)
                .map_err(|e| format!("Gagal menonaktifkan always-on-top: {}", e))?;
            Ok("floating".to_string())
        }
    }
}
