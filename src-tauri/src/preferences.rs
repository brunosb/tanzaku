use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum StartPolicy {
    #[default]
    GameFocus,
    Countdown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ShortcutAction {
    Pause,
    Stop,
    Play,
    Previous,
    Next,
    SeekBackward,
    SeekForward,
}
impl ShortcutAction {
    pub(crate) fn action(self) -> crate::playback::Action {
        use crate::playback::Action;
        match self {
            Self::Pause => Action::Pause,
            Self::Stop => Action::Stop,
            Self::Play => Action::Play,
            Self::Previous => Action::Previous,
            Self::Next => Action::Next,
            Self::SeekBackward => Action::SeekRelative(-5.0),
            Self::SeekForward => Action::SeekRelative(5.0),
        }
    }
}
pub(crate) type Bindings = BTreeMap<ShortcutAction, Option<String>>;
pub(crate) fn default_shortcuts() -> Bindings {
    use ShortcutAction::*;
    [
        (Pause, "Home"),
        (Stop, "End"),
        (Play, "Insert"),
        (Previous, "PageUp"),
        (Next, "PageDown"),
        (SeekBackward, "ArrowLeft"),
        (SeekForward, "ArrowRight"),
    ]
    .into_iter()
    .map(|(action, key)| (action, Some(format!("Control+Alt+{key}"))))
    .collect()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Preferences {
    pub start_mode: StartPolicy,
    pub shortcuts: Bindings,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            start_mode: StartPolicy::default(),
            shortcuts: default_shortcuts(),
        }
    }
}
impl Preferences {
    pub(crate) fn from_value(value: &serde_json::Value) -> Result<Self, String> {
        let mut preferences: Self = serde_json::from_value(value.clone())
            .map_err(|e| format!("Configurações inválidas: {e}"))?;
        for (action, binding) in default_shortcuts() {
            preferences.shortcuts.entry(action).or_insert(binding);
        }
        Ok(preferences)
    }
    pub(crate) fn extend(&self, value: &mut serde_json::Value) {
        value["startMode"] = serde_json::json!(self.start_mode);
        value["shortcuts"] = serde_json::json!(self.shortcuts);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_settings_receive_defaults_and_disabled_actions_stay_disabled() {
        let preferences =
            Preferences::from_value(&serde_json::json!({"shortcuts": {"pause": null}})).unwrap();
        assert_eq!(preferences.start_mode, StartPolicy::GameFocus);
        assert_eq!(preferences.shortcuts.len(), 7);
        assert_eq!(preferences.shortcuts[&ShortcutAction::Pause], None);
        assert!(Preferences::from_value(&serde_json::json!({"startMode":"invalid"})).is_err());
    }
}
