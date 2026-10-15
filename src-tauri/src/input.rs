use std::thread;

use crate::planner::Key;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct KeyboardEvent {
    pub keys: Vec<Key>,
    pub hold_ms: u64,
}

#[cfg(windows)]
mod platform {
    use std::sync::Mutex;

    use super::Key;

    type Hwnd = isize;
    const INPUT_KEYBOARD: u32 = 1;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const KEYEVENTF_SCANCODE: u32 = 0x0008;
    const VK_SHIFT: u16 = 0xa0;
    const VK_CONTROL: u16 = 0xa2;
    const SC_SHIFT: u16 = 0x2a;
    const SC_CONTROL: u16 = 0x1d;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeyboardInput {
        vk: u16,
        scan: u16,
        flags: u32,
        time: u32,
        extra_info: usize,
    }
    #[repr(C)]
    union InputData {
        keyboard: KeyboardInput,
        _padding: [u8; 32],
    }
    #[repr(C)]
    struct Input {
        input_type: u32,
        data: InputData,
    }

    unsafe extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut u32) -> u32;
        fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
    }

    static TARGET: Mutex<Option<(Hwnd, u32)>> = Mutex::new(None);

    fn foreground() -> Option<(Hwnd, u32)> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd == 0 {
            return None;
        }
        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };
        (process_id != 0).then_some((hwnd, process_id))
    }

    fn target_is_focused(force: bool) -> bool {
        let Ok(target) = TARGET.lock() else {
            return false;
        };
        let Some((target_hwnd, target_pid)) = *target else {
            return false;
        };
        if force {
            return target_hwnd != 0;
        }
        foreground().is_some_and(|(_, process_id)| process_id == target_pid)
    }

    fn send(scan: u16, vk: u16, up: bool, force: bool) -> bool {
        if !target_is_focused(force) {
            return false;
        }
        let input = Input {
            input_type: INPUT_KEYBOARD,
            data: InputData {
                keyboard: KeyboardInput {
                    vk,
                    scan,
                    flags: KEYEVENTF_SCANCODE | if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    extra_info: 0,
                },
            },
        };
        unsafe { SendInput(1, &input, std::mem::size_of::<Input>() as i32) == 1 }
    }

    pub fn arm() -> bool {
        let Some(target) = foreground() else {
            return false;
        };
        if let Ok(mut value) = TARGET.lock() {
            *value = Some(target);
            return true;
        }
        false
    }

    pub fn reset() {
        let _ = send(SC_SHIFT, VK_SHIFT, true, true);
        let _ = send(SC_CONTROL, VK_CONTROL, true, true);
        if let Ok(mut value) = TARGET.lock() {
            *value = None;
        }
    }

    pub fn event(keys: &[Key], hold_ms: u64) -> bool {
        if !target_is_focused(false) {
            return false;
        }
        for modifier in ["shift", "ctrl"] {
            if keys
                .iter()
                .any(|key| key.modifier.as_deref() == Some(modifier))
            {
                let (scan, vk) = if modifier == "shift" {
                    (SC_SHIFT, VK_SHIFT)
                } else {
                    (SC_CONTROL, VK_CONTROL)
                };
                let _ = send(scan, vk, false, false);
            }
        }
        let mut sent = false;
        for key in keys {
            if let Some(scan) = scan_code(&key.name) {
                sent |= send(scan, key.name.as_bytes()[0] as u16, false, false);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(hold_ms));
        for key in keys {
            if let Some(scan) = scan_code(&key.name) {
                let _ = send(scan, key.name.as_bytes()[0] as u16, true, true);
            }
        }
        if keys.iter().any(|key| key.modifier.is_some()) {
            let _ = send(SC_SHIFT, VK_SHIFT, true, true);
            let _ = send(SC_CONTROL, VK_CONTROL, true, true);
        }
        sent
    }

    fn scan_code(name: &str) -> Option<u16> {
        Some(match name {
            "Q" => 0x10,
            "W" => 0x11,
            "E" => 0x12,
            "R" => 0x13,
            "T" => 0x14,
            "Y" => 0x15,
            "U" => 0x16,
            "A" => 0x1e,
            "S" => 0x1f,
            "D" => 0x20,
            "F" => 0x21,
            "G" => 0x22,
            "H" => 0x23,
            "J" => 0x24,
            "Z" => 0x2c,
            "X" => 0x2d,
            "C" => 0x2e,
            "V" => 0x2f,
            "B" => 0x30,
            "N" => 0x31,
            "M" => 0x32,
            _ => return None,
        })
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Key;
    pub fn arm() -> bool {
        true
    }
    pub fn reset() {}
    pub fn event(_keys: &[Key], _hold_ms: u64) -> bool {
        true
    }
}

pub fn arm() -> bool {
    platform::arm()
}
pub fn reset() {
    platform::reset()
}
pub fn event(event: KeyboardEvent) -> bool {
    thread::spawn(move || platform::event(&event.keys, event.hold_ms));
    true
}
