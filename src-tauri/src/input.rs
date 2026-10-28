use crate::planner::Key;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stroke {
    pub scan: u16,
    pub up: bool,
}
pub trait Device: Send {
    fn arm(&mut self) -> Result<(), String>;
    fn focused(&self) -> bool;
    fn send(&mut self, events: &[Stroke]) -> Result<(), String>;
    fn disarm(&mut self);
    fn shortcuts(&self) -> (bool, bool) {
        (false, false)
    }
}
struct Held {
    index: usize,
    end: f64,
}
// The native playback worker owns both musical deadlines and this state. Key-up
// therefore follows speed changes without a second timer or a per-note thread.
pub struct Keyboard<D: Device> {
    pub device: D,
    held: BTreeMap<u16, Held>,
    modifier: Option<u16>,
}
impl<D: Device> Keyboard<D> {
    pub fn new(device: D) -> Self {
        Self {
            device,
            held: BTreeMap::new(),
            modifier: None,
        }
    }
    pub fn active(&self) -> Vec<usize> {
        let mut v = self.held.values().map(|h| h.index).collect::<Vec<_>>();
        v.sort_unstable();
        v.dedup();
        v
    }
    pub fn press(&mut self, index: usize, keys: &[Key], end: f64) -> Result<(), String> {
        if !self.device.focused() {
            return Err("A janela-alvo perdeu o foco.".to_string());
        }
        for key in keys {
            let scan =
                scan_code(&key.name).ok_or_else(|| format!("Tecla inválida: {}", key.name))?;
            let modifier = match key.modifier.as_deref() {
                Some("shift") => Some(0x2a),
                Some("ctrl") => Some(0x1d),
                _ => None,
            };
            if self.modifier != modifier {
                if let Some(scan) = self.modifier {
                    self.device.send(&[Stroke { scan, up: true }])?;
                    self.modifier = None;
                }
                if let Some(scan) = modifier {
                    self.device.send(&[Stroke { scan, up: false }])?;
                    self.modifier = modifier;
                }
            }
            if self.held.contains_key(&scan) {
                self.device.send(&[Stroke { scan, up: true }])?;
                self.held.remove(&scan);
            }
            self.device.send(&[Stroke { scan, up: false }])?;
            self.held.insert(scan, Held { index, end });
        }
        Ok(())
    }
    pub fn expire(&mut self, position: f64) -> Result<(), String> {
        let scans = self
            .held
            .iter()
            .filter_map(|(&scan, h)| (h.end <= position + 0.000001).then_some(scan))
            .collect::<Vec<_>>();
        if !scans.is_empty() {
            self.device.send(
                &scans
                    .iter()
                    .map(|&scan| Stroke { scan, up: true })
                    .collect::<Vec<_>>(),
            )?;
            for scan in scans {
                self.held.remove(&scan);
            }
        }
        if self.held.is_empty() {
            if let Some(scan) = self.modifier {
                self.device.send(&[Stroke { scan, up: true }])?;
                self.modifier = None;
            }
        }
        Ok(())
    }
    pub fn reset(&mut self, disarm: bool) -> Result<(), String> {
        let events = self
            .held
            .keys()
            .copied()
            .chain([0x2a, 0x1d])
            .map(|scan| Stroke { scan, up: true })
            .collect::<Vec<_>>();
        self.device.send(&events)?;
        self.held.clear();
        self.modifier = None;
        if disarm {
            self.device.disarm();
        }
        Ok(())
    }
}
impl<D: Device> Drop for Keyboard<D> {
    fn drop(&mut self) {
        let _ = self.reset(true);
    }
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
#[cfg(windows)]
mod platform {
    use super::{Device, Stroke};
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
    use super::{Device, Stroke};
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

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    #[derive(Default)]
    pub struct FakeDevice {
        pub armed: bool,
        pub sent: Vec<Stroke>,
        pub fail: bool,
    }
    impl Device for FakeDevice {
        fn arm(&mut self) -> Result<(), String> {
            self.armed = true;
            Ok(())
        }
        fn focused(&self) -> bool {
            self.armed
        }
        fn disarm(&mut self) {
            self.armed = false;
        }
        fn send(&mut self, events: &[Stroke]) -> Result<(), String> {
            if self.fail {
                Err("injected SendInput failure".to_string())
            } else {
                self.sent.extend_from_slice(events);
                Ok(())
            }
        }
    }
    pub fn key(name: &str, modifier: Option<&str>) -> Key {
        Key {
            name: name.to_owned(),
            label: name.to_owned(),
            modifier: modifier.map(str::to_owned),
        }
    }
    #[test]
    fn repeated_key_is_owned_by_latest_attack() {
        let mut k = Keyboard::new(FakeDevice::default());
        k.device.arm().unwrap();
        k.press(0, &[key("A", None)], 1.0).unwrap();
        k.press(1, &[key("A", None)], 2.0).unwrap();
        k.expire(1.0).unwrap();
        assert_eq!(k.active(), [1]);
        k.expire(2.0).unwrap();
        assert!(k.active().is_empty());
        assert_eq!(
            k.device
                .sent
                .iter()
                .filter(|e| e.scan == 0x1e && e.up)
                .count(),
            2
        );
    }
    #[test]
    fn natural_shift_ctrl_chords_release_all_modifiers() {
        let mut k = Keyboard::new(FakeDevice::default());
        k.device.arm().unwrap();
        k.press(
            0,
            &[
                key("A", Some("shift")),
                key("S", Some("ctrl")),
                key("D", None),
            ],
            3.0,
        )
        .unwrap();
        assert_eq!(k.active(), [0]);
        assert!(k.device.sent.windows(2).any(|p| p
            == [
                Stroke {
                    scan: 0x2a,
                    up: false
                },
                Stroke {
                    scan: 0x1e,
                    up: false
                }
            ]));
        k.reset(true).unwrap();
        assert!(k.active().is_empty());
        assert!(!k.device.armed);
        for scan in [0x1e, 0x1f, 0x20, 0x2a, 0x1d] {
            assert!(k.device.sent.contains(&Stroke { scan, up: true }));
        }
    }
    #[test]
    fn failed_send_never_confirms_attack() {
        let mut k = Keyboard::new(FakeDevice::default());
        k.device.arm().unwrap();
        k.device.fail = true;
        assert!(k.press(0, &[key("A", None)], 1.0).is_err());
        assert!(k.active().is_empty());
    }
}
