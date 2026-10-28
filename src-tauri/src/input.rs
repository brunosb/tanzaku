use crate::planner::Key;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct KeyboardEvent {
    pub keys: Vec<Key>,
    pub hold_ms: u64,
    pub generation: u64,
}

#[cfg(windows)]
mod platform {
    use std::{
        cmp::Reverse,
        collections::{BinaryHeap, HashMap},
        sync::{mpsc, mpsc::Sender, OnceLock},
        thread,
        time::{Duration, Instant},
    };

    use super::Key;
    use crate::timing::PreciseWaiter;

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

    struct HeldKey {
        vk: u16,
        owner: u64,
    }

    enum Command {
        Arm(mpsc::Sender<bool>),
        Event(Vec<Key>, u64, u64),
        Reset {
            disarm: bool,
            generation: u64,
            reply: mpsc::Sender<()>,
        },
    }

    struct KeyboardState {
        target: Option<(Hwnd, u32)>,
        held: HashMap<u16, HeldKey>,
        modifier: Option<&'static str>,
        next_owner: u64,
        generation: u64,
        expiries: BinaryHeap<Reverse<(Instant, u64)>>,
    }

    impl KeyboardState {
        fn new() -> Self {
            Self {
                target: None,
                held: HashMap::new(),
                modifier: None,
                next_owner: 0,
                generation: 0,
                expiries: BinaryHeap::new(),
            }
        }

        fn send(&self, inputs: &[Input], force: bool) -> bool {
            if inputs.is_empty() || !self.target_is_focused(force) {
                return false;
            }
            let sent = unsafe {
                SendInput(
                    inputs.len() as u32,
                    inputs.as_ptr(),
                    std::mem::size_of::<Input>() as i32,
                )
            };
            if sent > 0 && sent < inputs.len() as u32 {
                let releases = inputs[..sent as usize]
                    .iter()
                    .map(|input| {
                        let key = unsafe { input.data.keyboard };
                        Self::key_input(key.scan, key.vk, true)
                    })
                    .collect::<Vec<_>>();
                unsafe {
                    SendInput(
                        releases.len() as u32,
                        releases.as_ptr(),
                        std::mem::size_of::<Input>() as i32,
                    );
                }
            }
            sent == inputs.len() as u32
        }

        fn target_is_focused(&self, force: bool) -> bool {
            let Some((target_hwnd, target_pid)) = self.target else {
                return false;
            };
            if force {
                return target_hwnd != 0;
            }
            foreground().is_some_and(|(_, process_id)| process_id == target_pid)
        }

        fn key_input(scan: u16, vk: u16, up: bool) -> Input {
            Input {
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
            }
        }

        fn modifier_input(modifier: &'static str, up: bool) -> Input {
            let (scan, vk) = if modifier == "shift" {
                (SC_SHIFT, VK_SHIFT)
            } else {
                (SC_CONTROL, VK_CONTROL)
            };
            Self::key_input(scan, vk, up)
        }

        fn set_modifier(&mut self, next: Option<&'static str>) -> bool {
            if self.modifier == next {
                return true;
            }
            if let Some(current) = self.modifier {
                if !self.send(&[Self::modifier_input(current, true)], true) {
                    return false;
                }
                self.modifier = None;
            }
            if let Some(next) = next {
                if !self.send(&[Self::modifier_input(next, false)], false) {
                    return false;
                }
                self.modifier = Some(next);
            }
            true
        }

        fn press(&mut self, keys: &[Key], hold_ms: u64) {
            if keys.is_empty() || !self.target_is_focused(false) {
                return;
            }
            self.next_owner = self.next_owner.wrapping_add(1).max(1);
            let owner = self.next_owner;
            let mut groups: Vec<(Option<&'static str>, Vec<(u16, u16)>)> = Vec::new();
            for key in keys {
                let Some(scan) = scan_code(&key.name) else {
                    continue;
                };
                let modifier = match key.modifier.as_deref() {
                    Some("shift") => Some("shift"),
                    Some("ctrl") => Some("ctrl"),
                    _ => None,
                };
                let group_index = groups.iter().position(|group| group.0 == modifier);
                let index = group_index.unwrap_or_else(|| {
                    groups.push((modifier, Vec::new()));
                    groups.len() - 1
                });
                groups[index].1.push((scan, key.name.as_bytes()[0] as u16));
            }

            let mut pressed = false;
            for (modifier, keys) in groups {
                if !self.set_modifier(modifier) {
                    break;
                }

                let repeated = keys
                    .iter()
                    .filter_map(|(scan, _)| self.held.get(scan).map(|held| (*scan, held.vk)))
                    .collect::<Vec<_>>();
                if !repeated.is_empty() {
                    let releases = repeated
                        .iter()
                        .map(|(scan, vk)| Self::key_input(*scan, *vk, true))
                        .collect::<Vec<_>>();
                    self.send(&releases, true);
                    for (scan, _) in repeated {
                        self.held.remove(&scan);
                    }
                }

                let downs = keys
                    .iter()
                    .map(|(scan, vk)| Self::key_input(*scan, *vk, false))
                    .collect::<Vec<_>>();
                if self.send(&downs, false) {
                    for (scan, vk) in keys {
                        self.held.insert(scan, HeldKey { vk, owner });
                    }
                    pressed = true;
                }
            }

            if pressed {
                self.expiries.push(Reverse((
                    Instant::now() + Duration::from_millis(hold_ms),
                    owner,
                )));
            } else if self.held.is_empty() {
                self.release_modifiers();
            }
        }

        fn release_owner(&mut self, owner: u64) {
            let owned = self
                .held
                .iter()
                .filter_map(|(scan, held)| (held.owner == owner).then_some((*scan, held.vk)))
                .collect::<Vec<_>>();
            if !owned.is_empty() {
                let releases = owned
                    .iter()
                    .map(|(scan, vk)| Self::key_input(*scan, *vk, true))
                    .collect::<Vec<_>>();
                self.send(&releases, true);
                for (scan, _) in owned {
                    self.held.remove(&scan);
                }
            }
            if self.held.is_empty() {
                self.release_modifiers();
            }
        }

        fn release_modifiers(&mut self) {
            for modifier in ["shift", "ctrl"] {
                self.send(&[Self::modifier_input(modifier, true)], true);
            }
            self.modifier = None;
        }

        fn reset(&mut self, disarm: bool, generation: u64) {
            if generation < self.generation {
                return;
            }
            self.generation = generation;
            let releases = self
                .held
                .iter()
                .map(|(scan, held)| Self::key_input(*scan, held.vk, true))
                .collect::<Vec<_>>();
            self.send(&releases, true);
            self.held.clear();
            self.expiries.clear();
            self.release_modifiers();
            if disarm {
                self.target = None;
            }
        }
    }

    static COMMANDS: OnceLock<Sender<Command>> = OnceLock::new();

    fn commands() -> &'static Sender<Command> {
        COMMANDS.get_or_init(|| {
            let (sender, receiver) = mpsc::channel();
            thread::spawn(move || run_worker(receiver));
            sender
        })
    }

    fn run_worker(receiver: mpsc::Receiver<Command>) {
        let mut state = KeyboardState::new();
        let mut waiter = PreciseWaiter::new();
        loop {
            while state
                .expiries
                .peek()
                .is_some_and(|Reverse((deadline, _))| *deadline <= Instant::now())
            {
                if let Some(Reverse((_, owner))) = state.expiries.pop() {
                    state.release_owner(owner);
                }
            }
            let wait = state
                .expiries
                .peek()
                .map(|Reverse((deadline, _))| deadline.saturating_duration_since(Instant::now()));
            let command = match wait {
                Some(wait) => match receiver.try_recv() {
                    Ok(command) => command,
                    Err(mpsc::TryRecvError::Disconnected) => break,
                    Err(mpsc::TryRecvError::Empty) => {
                        waiter.wait(wait.min(Duration::from_millis(1)));
                        continue;
                    }
                },
                None => match receiver.recv() {
                    Ok(command) => command,
                    Err(_) => break,
                },
            };
            match command {
                Command::Arm(reply) => {
                    let armed = foreground().is_some_and(|target| {
                        state.target = Some(target);
                        true
                    });
                    let _ = reply.send(armed);
                }
                Command::Event(keys, hold_ms, generation) => {
                    if generation == state.generation {
                        state.press(&keys, hold_ms);
                    }
                }
                Command::Reset {
                    disarm,
                    generation,
                    reply,
                } => {
                    state.reset(disarm, generation);
                    let _ = reply.send(());
                }
            }
        }
    }

    fn foreground() -> Option<(Hwnd, u32)> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd == 0 {
            return None;
        }
        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };
        (process_id != 0).then_some((hwnd, process_id))
    }

    pub fn arm() -> bool {
        let (reply, result) = mpsc::channel();
        commands().send(Command::Arm(reply)).is_ok() && result.recv().unwrap_or(false)
    }

    pub fn reset(generation: u64) {
        reset_inner(true, generation);
    }

    pub fn release(generation: u64) {
        reset_inner(false, generation);
    }

    fn reset_inner(disarm: bool, generation: u64) {
        let (reply, result) = mpsc::channel();
        if commands()
            .send(Command::Reset {
                disarm,
                generation,
                reply,
            })
            .is_ok()
        {
            let _ = result.recv();
        }
    }

    pub fn event(keys: &[Key], hold_ms: u64, generation: u64) -> bool {
        commands()
            .send(Command::Event(keys.to_vec(), hold_ms, generation))
            .is_ok()
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
    pub fn reset(_generation: u64) {}
    pub fn release(_generation: u64) {}
    pub fn event(_keys: &[Key], _hold_ms: u64, _generation: u64) -> bool {
        true
    }
}

pub fn arm() -> bool {
    platform::arm()
}
pub fn reset(generation: u64) {
    platform::reset(generation)
}
pub fn release(generation: u64) {
    platform::release(generation)
}
pub fn event(event: KeyboardEvent) -> bool {
    platform::event(&event.keys, event.hold_ms, event.generation)
}
