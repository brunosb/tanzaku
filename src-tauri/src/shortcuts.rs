use crate::{
    playback::PlaybackController,
    preferences::{Bindings, ShortcutAction},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default)]
struct State {
    active: BTreeMap<u32, (Shortcut, ShortcutAction)>,
    warnings: Vec<String>,
}
impl State {
    fn dispatch(
        &self,
        shortcut: &Shortcut,
        event: ShortcutState,
    ) -> Option<crate::playback::Action> {
        let id = shortcut.id();
        if event == ShortcutState::Released {
            return None;
        }
        // The Windows plugin registers MOD_NOREPEAT. Its release notifications are
        // polled, so debouncing them here would lose rapid consecutive presses.
        self.active.get(&id).map(|(_, action)| action.action())
    }
}
#[derive(Default)]
pub(crate) struct Shortcuts {
    // Settings updates and storage switches share this lock, never the playback worker.
    pub(crate) operation: Mutex<()>,
    state: Mutex<State>,
}

fn parse(bindings: &Bindings) -> Result<Vec<(Shortcut, ShortcutAction)>, String> {
    let mut seen = BTreeSet::new();
    let mut parsed = Vec::new();
    for (&action, binding) in bindings {
        let Some(binding) = binding else {
            continue;
        };
        let shortcut: Shortcut = binding
            .parse()
            .map_err(|e| format!("Atalho inválido ({binding}): {e}"))?;
        if !seen.insert(shortcut.id()) {
            return Err(format!("Atalho duplicado: {binding}"));
        }
        let musical = matches!(
            shortcut.key,
            Code::KeyQ
                | Code::KeyW
                | Code::KeyE
                | Code::KeyR
                | Code::KeyT
                | Code::KeyY
                | Code::KeyU
                | Code::KeyA
                | Code::KeyS
                | Code::KeyD
                | Code::KeyF
                | Code::KeyG
                | Code::KeyH
                | Code::KeyJ
                | Code::KeyZ
                | Code::KeyX
                | Code::KeyC
                | Code::KeyV
                | Code::KeyB
                | Code::KeyN
                | Code::KeyM
        );
        if musical
            && (shortcut.mods.is_empty()
                || shortcut.mods == Modifiers::SHIFT
                || shortcut.mods == Modifiers::CONTROL)
        {
            return Err(format!(
                "O atalho {binding} coincide com uma tecla musical."
            ));
        }
        parsed.push((shortcut, action));
    }
    Ok(parsed)
}

impl Shortcuts {
    pub(crate) fn warnings(&self) -> Vec<String> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .warnings
            .clone()
    }
    pub(crate) fn handle(&self, app: &AppHandle, shortcut: &Shortcut, event: ShortcutState) {
        let action = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.dispatch(shortcut, event)
        };
        if let Some(action) = action {
            let _ = app.state::<PlaybackController>().enqueue(action);
        }
    }
    // Caller holds operation. A rejected update restores the previously active shortcuts.
    pub(crate) fn replace(
        &self,
        app: &AppHandle,
        bindings: &Bindings,
        save: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let next = parse(bindings)?;
        let previous = self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active
            .clone();
        let result = (|| {
            for (shortcut, _) in previous.values() {
                app.global_shortcut()
                    .unregister(*shortcut)
                    .map_err(|e| e.to_string())?;
            }
            self.state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .active
                .clear();
            for (shortcut, action) in next {
                app.global_shortcut()
                    .register(shortcut)
                    .map_err(|e| format!("Atalho indisponível ({shortcut}): {e}"))?;
                self.state
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .active
                    .insert(shortcut.id(), (shortcut, action));
            }
            save()
        })();
        if result.is_err() {
            self.restore_active(app, previous);
        } else {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.warnings.clear();
        }
        result
    }
    fn restore_active(&self, app: &AppHandle, previous: BTreeMap<u32, (Shortcut, ShortcutAction)>) {
        let active = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut state.active)
        };
        for (shortcut, _) in active.values() {
            let _ = app.global_shortcut().unregister(*shortcut);
        }
        for (id, (shortcut, action)) in previous {
            if app.global_shortcut().is_registered(shortcut)
                || app.global_shortcut().register(shortcut).is_ok()
            {
                self.state
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .active
                    .insert(id, (shortcut, action));
            } else {
                self.state
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .warnings
                    .push(format!("Não foi possível restaurar o atalho {shortcut}."));
            }
        }
    }
    // Startup / storage switching: one unavailable binding must not disable the others.
    pub(crate) fn restore(&self, app: &AppHandle, bindings: &Bindings) {
        self.restore_active(app, BTreeMap::new());
        let mut warnings = Vec::new();
        let mut seen = BTreeSet::new();
        for (&action, binding) in bindings {
            let single = [(action, binding.clone())].into_iter().collect();
            match parse(&single) {
                Ok(parsed) => {
                    for (shortcut, action) in parsed {
                        if !seen.insert(shortcut.id()) {
                            warnings.push(format!("Atalho duplicado: {shortcut}"));
                            continue;
                        }
                        match app.global_shortcut().register(shortcut) {
                            Ok(()) => {
                                self.state
                                    .lock()
                                    .unwrap_or_else(|e| e.into_inner())
                                    .active
                                    .insert(shortcut.id(), (shortcut, action));
                            }
                            Err(error) => {
                                warnings.push(format!("Atalho indisponível ({shortcut}): {error}"))
                            }
                        }
                    }
                }
                Err(error) => warnings.push(error),
            }
        }
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .warnings = warnings;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_are_valid_and_aliases_and_musical_keys_are_checked() {
        let mut bindings = crate::preferences::default_shortcuts();
        assert_eq!(parse(&bindings).unwrap().len(), 7);
        bindings.insert(ShortcutAction::Play, Some("Ctrl+Alt+Home".into()));
        assert!(parse(&bindings).unwrap_err().contains("duplicado"));
        bindings.insert(ShortcutAction::Play, Some("Control+KeyA".into()));
        assert!(parse(&bindings).unwrap_err().contains("musical"));
        bindings.insert(ShortcutAction::Play, None);
        assert_eq!(parse(&bindings).unwrap().len(), 6);
    }
    #[test]
    fn shortcuts_dispatch_existing_actions_without_waiting_for_delayed_release() {
        use crate::playback::Action;
        let parsed = parse(&crate::preferences::default_shortcuts()).unwrap();
        let mut state = State::default();
        for &(shortcut, action) in &parsed {
            state.active.insert(shortcut.id(), (shortcut, action));
        }
        for (shortcut, action) in parsed {
            let command = state.dispatch(&shortcut, ShortcutState::Pressed).unwrap();
            assert!(matches!(
                (action, command),
                (ShortcutAction::Pause, Action::Pause)
                    | (ShortcutAction::Stop, Action::Stop)
                    | (ShortcutAction::Play, Action::Play)
                    | (ShortcutAction::Previous, Action::Previous)
                    | (ShortcutAction::Next, Action::Next)
                    | (ShortcutAction::SeekBackward, Action::SeekRelative(-5.0))
                    | (ShortcutAction::SeekForward, Action::SeekRelative(5.0))
            ));
            assert!(state.dispatch(&shortcut, ShortcutState::Pressed).is_some());
            assert!(state.dispatch(&shortcut, ShortcutState::Released).is_none());
            assert!(state.dispatch(&shortcut, ShortcutState::Pressed).is_some());
        }
    }
}
