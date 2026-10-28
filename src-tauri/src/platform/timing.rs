#[cfg(windows)]
mod platform {
    use std::{ptr, time::Duration};

    type Handle = *mut std::ffi::c_void;

    const CREATE_WAITABLE_TIMER_HIGH_RESOLUTION: u32 = 0x0000_0002;
    const TIMER_ALL_ACCESS: u32 = 0x001f_0003;
    const WAIT_OBJECT_0: u32 = 0;
    const INFINITE: u32 = u32::MAX;

    unsafe extern "system" {
        fn CreateWaitableTimerExW(
            attributes: *const std::ffi::c_void,
            name: *const u16,
            flags: u32,
            access: u32,
        ) -> Handle;
        fn SetWaitableTimer(
            timer: Handle,
            due_time: *const i64,
            period: i32,
            completion: *const std::ffi::c_void,
            argument: *const std::ffi::c_void,
            resume: i32,
        ) -> i32;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    pub struct PreciseWaiter {
        timer: Handle,
    }

    impl PreciseWaiter {
        pub fn new() -> Self {
            let timer = unsafe {
                let high_resolution = CreateWaitableTimerExW(
                    ptr::null(),
                    ptr::null(),
                    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                    TIMER_ALL_ACCESS,
                );
                if high_resolution.is_null() {
                    CreateWaitableTimerExW(ptr::null(), ptr::null(), 0, TIMER_ALL_ACCESS)
                } else {
                    high_resolution
                }
            };
            Self { timer }
        }

        pub fn wait(&mut self, duration: Duration) {
            if duration.is_zero() {
                return;
            }
            if self.timer.is_null() {
                std::thread::sleep(duration);
                return;
            }

            let ticks = duration.as_nanos().div_ceil(100).min(i64::MAX as u128) as i64;
            let due_time = -ticks.max(1);
            let armed = unsafe {
                SetWaitableTimer(self.timer, &due_time, 0, ptr::null(), ptr::null(), 0) != 0
            };
            if armed {
                let result = unsafe { WaitForSingleObject(self.timer, INFINITE) };
                if result == WAIT_OBJECT_0 {
                    return;
                }
            }
            std::thread::sleep(duration);
        }
    }

    impl Drop for PreciseWaiter {
        fn drop(&mut self) {
            if !self.timer.is_null() {
                unsafe { CloseHandle(self.timer) };
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::time::Duration;

    pub struct PreciseWaiter;

    impl PreciseWaiter {
        pub fn new() -> Self {
            Self
        }

        pub fn wait(&mut self, duration: Duration) {
            std::thread::sleep(duration);
        }
    }
}

pub use platform::PreciseWaiter;
