#[cfg(windows)]
mod platform {
    use crate::playback::keyboard::{Device, Stroke};
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeyboardInput {
        vk: u16,
        scan: u16,
        flags: u32,
        time: u32,
        extra: usize,
    }
    #[repr(C)]
    union InputData {
        keyboard: KeyboardInput,
        padding: [u8; 32],
    }
    #[repr(C)]
    struct Input {
        kind: u32,
        data: InputData,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> isize;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
        fn GetAsyncKeyState(key: i32) -> i16;
    }
    #[derive(Default)]
    pub struct NativeDevice {
        target: Option<u32>,
    }
    fn foreground() -> Option<u32> {
        let hwnd = unsafe { GetForegroundWindow() };
        let mut pid = 0;
        if hwnd != 0 {
            unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        }
        (pid != 0).then_some(pid)
    }
    impl Device for NativeDevice {
        fn arm(&mut self) -> Result<(), String> {
            self.target = foreground().filter(|pid| *pid != std::process::id());
            if self.target.is_none() {
                Err("Foque a janela do jogo durante a contagem.".to_string())
            } else {
                Ok(())
            }
        }
        fn focused(&self) -> bool {
            self.target.is_some() && self.target == foreground()
        }
        fn disarm(&mut self) {
            self.target = None;
        }
        fn shortcuts(&self) -> (bool, bool) {
            unsafe { (GetAsyncKeyState(0x24) < 0, GetAsyncKeyState(0x23) < 0) }
        }
        fn send(&mut self, events: &[Stroke]) -> Result<(), String> {
            if self.target.is_none() || events.is_empty() {
                return Ok(());
            }
            let inputs = events
                .iter()
                .map(|e| Input {
                    kind: 1,
                    data: InputData {
                        keyboard: KeyboardInput {
                            vk: 0,
                            scan: e.scan,
                            flags: 0x8 | if e.up { 0x2 } else { 0 },
                            time: 0,
                            extra: 0,
                        },
                    },
                })
                .collect::<Vec<_>>();
            let sent = unsafe {
                SendInput(
                    inputs.len() as u32,
                    inputs.as_ptr(),
                    std::mem::size_of::<Input>() as i32,
                )
            };
            if sent == inputs.len() as u32 {
                Ok(())
            } else {
                // Recover every attempted down after a partial batch.
                let releases = events
                    .iter()
                    .filter(|e| !e.up)
                    .map(|e| Input {
                        kind: 1,
                        data: InputData {
                            keyboard: KeyboardInput {
                                vk: 0,
                                scan: e.scan,
                                flags: 0xa,
                                time: 0,
                                extra: 0,
                            },
                        },
                    })
                    .collect::<Vec<_>>();
                if !releases.is_empty() {
                    unsafe {
                        SendInput(
                            releases.len() as u32,
                            releases.as_ptr(),
                            std::mem::size_of::<Input>() as i32,
                        )
                    };
                }
                Err(format!(
                    "SendInput enviou {sent}/{} eventos: {}",
                    events.len(),
                    std::io::Error::last_os_error()
                ))
            }
        }
    }
}
#[cfg(not(windows))]
mod platform {
    use crate::playback::keyboard::{Device, Stroke};
    #[derive(Default)]
    pub struct NativeDevice;
    impl Device for NativeDevice {
        fn arm(&mut self) -> Result<(), String> {
            Err("A reprodução requer Windows x64.".to_string())
        }
        fn focused(&self) -> bool {
            false
        }
        fn disarm(&mut self) {}
        fn send(&mut self, _: &[Stroke]) -> Result<(), String> {
            Ok(())
        }
    }
}
pub use platform::NativeDevice;
