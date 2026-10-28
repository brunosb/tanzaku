use super::control;
use crate::{
    music::types,
    playback::{Action, PlaybackController, Snapshot},
};
#[tauri::command]
pub(crate) async fn playback_load(
    id: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<types::PlaybackPlan, String> {
    Ok(control(controller.inner().clone(), Action::Load(id))
        .await?
        .plan)
}

#[tauri::command]

pub(crate) async fn playback_start(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(controller.inner().clone(), Action::Play)
        .await
        .map(|_| ())
}

#[tauri::command]

pub(crate) async fn playback_pause(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(controller.inner().clone(), Action::Pause)
        .await
        .map(|_| ())
}

#[tauri::command]

pub(crate) async fn playback_stop(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(controller.inner().clone(), Action::Stop)
        .await
        .map(|_| ())
}

#[tauri::command]

pub(crate) async fn playback_seek(
    position: f64,
    resume: Option<bool>,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(
        controller.inner().clone(),
        Action::Seek(position, resume.unwrap_or(false)),
    )
    .await
    .map(|_| ())
}

#[tauri::command]

pub(crate) async fn playback_set_speed(
    speed: f64,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(controller.inner().clone(), Action::Speed(speed))
        .await
        .map(|_| ())
}

#[tauri::command]

pub(crate) async fn playback_toggle_repeat(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<bool, String> {
    Ok(control(controller.inner().clone(), Action::Repeat)
        .await?
        .state
        .repeat_enabled)
}

#[tauri::command]

pub(crate) async fn playback_get_snapshot(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<Snapshot, String> {
    control(controller.inner().clone(), Action::Snapshot).await
}
