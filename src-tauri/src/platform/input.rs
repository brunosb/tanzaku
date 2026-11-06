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
    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> isize;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
        fn IsWindow(hwnd: isize) -> i32;
        fn IsIconic(hwnd: isize) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn GetParent(hwnd: isize) -> isize;
        fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
        fn EnumChildWindows(
            hwnd: isize,
            callback: unsafe extern "system" fn(isize, isize) -> i32,
            data: isize,
        ) -> i32;
        fn MapVirtualKeyW(code: u32, kind: u32) -> u32;
        fn PostMessageW(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, process: u32) -> *mut std::ffi::c_void;
        fn QueryFullProcessImageNameW(
            process: *mut std::ffi::c_void,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, process: u32) -> *mut std::ffi::c_void;
        fn Process32FirstW(snapshot: *mut std::ffi::c_void, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snapshot: *mut std::ffi::c_void, entry: *mut ProcessEntry) -> i32;
    }
    #[repr(C)]
    struct ProcessEntry {
        size: u32,
        usage: u32,
        process: u32,
        heap: usize,
        module: u32,
        threads: u32,
        parent: u32,
        priority: i32,
        flags: u32,
        executable: [u16; 260],
    }
    struct Handle(*mut std::ffi::c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    fn game_process(process: u32) -> bool {
        if process == 0 || process == std::process::id() {
            return false;
        }
        let handle = unsafe { OpenProcess(0x1000, 0, process) };
        if !handle.is_null() {
            let handle = Handle(handle);
            let mut buffer = vec![0u16; 32768];
            let mut size = buffer.len() as u32;
            if unsafe { QueryFullProcessImageNameW(handle.0, 0, buffer.as_mut_ptr(), &mut size) }
                != 0
            {
                let path = String::from_utf16_lossy(&buffer[..size as usize]);
                return path
                    .rsplit('\\')
                    .next()
                    .is_some_and(|name| name.eq_ignore_ascii_case("wwm.exe"));
            }
        }
        // Process enumeration also identifies elevated games without reading their memory.
        let snapshot = unsafe { CreateToolhelp32Snapshot(2, 0) };
        if snapshot == -1isize as *mut std::ffi::c_void {
            return false;
        }
        let snapshot = Handle(snapshot);
        let mut entry = ProcessEntry {
            size: std::mem::size_of::<ProcessEntry>() as u32,
            usage: 0,
            process: 0,
            heap: 0,
            module: 0,
            threads: 0,
            parent: 0,
            priority: 0,
            flags: 0,
            executable: [0; 260],
        };
        let mut found = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
        while found {
            if entry.process == process {
                let end = entry.executable.iter().position(|&c| c == 0).unwrap_or(260);
                return String::from_utf16_lossy(&entry.executable[..end])
                    .eq_ignore_ascii_case("wwm.exe");
            }
            found = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
        }
        false
    }
    fn pid(hwnd: isize) -> u32 {
        let mut value = 0;
        if hwnd != 0 {
            unsafe {
                GetWindowThreadProcessId(hwnd, &mut value);
            }
        }
        value
    }
    struct Target {
        primary: isize,
        process: u32,
        windows: Vec<isize>,
    }
    impl Target {
        fn owns(&self, hwnd: isize) -> bool {
            unsafe { IsWindow(hwnd) != 0 && pid(hwnd) == self.process }
        }
    }
    unsafe extern "system" fn collect(hwnd: isize, data: isize) -> i32 {
        let target = unsafe { &mut *(data as *mut Target) };
        if !target.owns(hwnd) || unsafe { IsWindowVisible(hwnd) } == 0 {
            return 1;
        }
        let parent = unsafe { GetParent(hwnd) };
        if parent != target.primary && unsafe { GetParent(parent) } != target.primary {
            return 1;
        }
        let mut rect = Rect::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) } != 0
            && i64::from((rect.right - rect.left).max(0))
                * i64::from((rect.bottom - rect.top).max(0))
                > 5000
            && !target.windows.contains(&hwnd)
        {
            target.windows.push(hwnd);
        }
        1
    }
    pub struct NativeDevice {
        target: Option<Target>,
        background: bool,
    }
    impl Default for NativeDevice {
        fn default() -> Self {
            Self {
                target: None,
                background: true,
            }
        }
    }
    fn key_message(event: Stroke) -> (u32, usize, isize) {
        let vk = unsafe { MapVirtualKeyW(u32::from(event.scan), 1) } as usize;
        let flags = if event.up {
            (1u32 << 30) | (1u32 << 31)
        } else {
            0
        };
        (
            if event.up { 0x101 } else { 0x100 },
            vk,
            (1u32 | (u32::from(event.scan) << 16) | flags) as isize,
        )
    }
    fn post(hwnd: isize, event: Stroke) -> Result<(), String> {
        let (message, vk, param) = key_message(event);
        if vk == 0 {
            return Err(format!("Scan code inválido: {}", event.scan));
        }
        if unsafe { PostMessageW(hwnd, message, vk, param) } != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(5) {
            Err("O Windows bloqueou o envio ao jogo. Execute o Tanzaku com o mesmo nível de permissão do jogo (administrador, se necessário).".to_string())
        } else {
            Err(format!("Falha ao enviar nota à janela do jogo: {error}"))
        }
    }
    fn input(event: Stroke) -> Input {
        Input {
            kind: 1,
            data: InputData {
                keyboard: KeyboardInput {
                    vk: 0,
                    scan: event.scan,
                    flags: 0x8 | if event.up { 0x2 } else { 0 },
                    time: 0,
                    extra: 0,
                },
            },
        }
    }
    impl Device for NativeDevice {
        fn game_focused(&self) -> bool {
            let window = unsafe { GetForegroundWindow() };
            window != 0 && unsafe { IsIconic(window) } == 0 && game_process(pid(window))
        }
        fn arm(&mut self) -> Result<(), String> {
            self.target = None;
            let primary = unsafe { GetForegroundWindow() };
            let process = pid(primary);
            if !game_process(process) || unsafe { IsIconic(primary) } != 0 {
                return Err(
                    "Foque a janela de Where Winds Meet (wwm.exe) para começar.".to_string()
                );
            }
            let mut target = Target {
                primary,
                process,
                windows: vec![primary],
            };
            unsafe {
                EnumChildWindows(primary, collect, &mut target as *mut Target as isize);
            }
            self.target = Some(target);
            Ok(())
        }
        fn focused(&self) -> bool {
            self.target.as_ref().is_some_and(|t| {
                t.owns(t.primary) && pid(unsafe { GetForegroundWindow() }) == t.process
            })
        }
        fn available(&self) -> bool {
            self.target.as_ref().is_some_and(|t| {
                t.owns(t.primary)
                    && unsafe { IsIconic(t.primary) } == 0
                    && t.windows.iter().all(|&hwnd| t.owns(hwnd))
            }) && (self.background || self.focused())
        }
        fn unavailable_reason(&self) -> &'static str {
            if self.background {
                "target-unavailable"
            } else {
                "focus-lost"
            }
        }
        fn set_background(&mut self, enabled: bool) {
            self.background = enabled;
        }
        fn disarm(&mut self) {
            self.target = None;
        }
        fn send(&mut self, events: &[Stroke]) -> Result<(), String> {
            let Some(target) = &self.target else {
                return Ok(());
            };
            if events.is_empty() {
                return Ok(());
            }
            if self.background {
                let mut first_error = None;
                let mut downs = Vec::new();
                for &hwnd in &target.windows {
                    if !target.owns(hwnd) {
                        first_error
                            .get_or_insert_with(|| "A janela do jogo foi fechada.".to_string());
                        continue;
                    }
                    for &event in events {
                        if let Err(error) = post(hwnd, event) {
                            first_error.get_or_insert(error);
                            if !event.up {
                                break;
                            }
                        } else if !event.up {
                            downs.push((hwnd, event.scan));
                        }
                    }
                    if first_error.is_some() && events.iter().any(|event| !event.up) {
                        break;
                    }
                }
                if let Some(error) = first_error {
                    for (hwnd, scan) in downs {
                        if target.owns(hwnd) {
                            let _ = post(hwnd, Stroke { scan, up: true });
                        }
                    }
                    return Err(error);
                }
                return Ok(());
            }
            if events.iter().any(|event| !event.up) && !self.available() {
                return Err("A janela do jogo perdeu o foco.".to_string());
            }
            let inputs = events.iter().copied().map(input).collect::<Vec<_>>();
            let sent = unsafe {
                SendInput(
                    inputs.len() as u32,
                    inputs.as_ptr(),
                    std::mem::size_of::<Input>() as i32,
                )
            };
            if sent == inputs.len() as u32 {
                return Ok(());
            }
            let error = std::io::Error::last_os_error();
            let releases = events
                .iter()
                .filter(|e| !e.up)
                .map(|e| {
                    input(Stroke {
                        scan: e.scan,
                        up: true,
                    })
                })
                .collect::<Vec<_>>();
            if !releases.is_empty() {
                unsafe {
                    SendInput(
                        releases.len() as u32,
                        releases.as_ptr(),
                        std::mem::size_of::<Input>() as i32,
                    );
                }
            }
            Err(format!("SendInput enviou {sent}/{} eventos. Verifique as permissões do jogo e do Tanzaku: {error}", events.len()))
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn messages_encode_key_modifier_and_release_bits() {
            for (scan, vk) in [(0x1e, 0x41), (0x2a, 0x10), (0x1d, 0x11)] {
                assert_eq!(
                    key_message(Stroke { scan, up: false }),
                    (0x100, vk, (1 | (u32::from(scan) << 16)) as isize)
                );
                let (msg, actual_vk, param) = key_message(Stroke { scan, up: true });
                assert_eq!((msg, actual_vk), (0x101, vk));
                assert_eq!((param as u32) >> 30, 3);
            }
        }
        #[test]
        fn unarmed_device_never_targets_the_foreground() {
            let mut device = NativeDevice::default();
            assert!(!device.available());
            device
                .send(&[Stroke {
                    scan: 0x1e,
                    up: false,
                }])
                .unwrap();
        }
        #[test]
        fn background_messages_reach_only_the_captured_window_and_closed_targets_pause() {
            #[repr(C)]
            #[derive(Default)]
            struct Message {
                hwnd: isize,
                message: u32,
                wparam: usize,
                lparam: isize,
                time: u32,
                x: i32,
                y: i32,
                private: u32,
            }
            #[link(name = "user32")]
            unsafe extern "system" {
                fn CreateWindowExW(
                    ex: u32,
                    class: *const u16,
                    title: *const u16,
                    style: u32,
                    x: i32,
                    y: i32,
                    width: i32,
                    height: i32,
                    parent: isize,
                    menu: isize,
                    instance: isize,
                    param: *const std::ffi::c_void,
                ) -> isize;
                fn DestroyWindow(hwnd: isize) -> i32;
                fn PeekMessageW(
                    message: *mut Message,
                    hwnd: isize,
                    min: u32,
                    max: u32,
                    remove: u32,
                ) -> i32;
            }
            struct Window(isize);
            impl Drop for Window {
                fn drop(&mut self) {
                    if self.0 != 0 {
                        unsafe {
                            DestroyWindow(self.0);
                        }
                    }
                }
            }
            let class = "STATIC\0".encode_utf16().collect::<Vec<_>>();
            let make = || {
                let hwnd = unsafe {
                    CreateWindowExW(
                        0,
                        class.as_ptr(),
                        class.as_ptr(),
                        0,
                        0,
                        0,
                        100,
                        100,
                        -3,
                        0,
                        0,
                        std::ptr::null(),
                    )
                };
                assert_ne!(hwnd, 0);
                Window(hwnd)
            };
            let mut captured = make();
            let other = make();
            let mut device = NativeDevice {
                target: Some(Target {
                    primary: captured.0,
                    process: std::process::id(),
                    windows: vec![captured.0],
                }),
                background: true,
            };
            assert!(device.available());
            let events = [
                Stroke {
                    scan: 0x1d,
                    up: false,
                },
                Stroke {
                    scan: 0x1e,
                    up: false,
                },
                Stroke {
                    scan: 0x1e,
                    up: true,
                },
                Stroke {
                    scan: 0x1d,
                    up: true,
                },
            ];
            device.send(&events).unwrap();
            for event in events {
                let mut received = Message::default();
                assert_ne!(
                    unsafe { PeekMessageW(&mut received, captured.0, 0x100, 0x101, 1) },
                    0
                );
                assert_eq!(
                    (received.message, received.wparam, received.lparam),
                    key_message(event)
                );
            }
            let mut received = Message::default();
            assert_eq!(
                unsafe { PeekMessageW(&mut received, other.0, 0x100, 0x101, 1) },
                0
            );
            unsafe {
                DestroyWindow(captured.0);
            }
            captured.0 = 0;
            assert!(!device.available());
            assert!(device.send(&events).is_err());
            assert_eq!(
                unsafe { PeekMessageW(&mut received, other.0, 0x100, 0x101, 1) },
                0
            );
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
