use super::blocking;
use super::control;
#[tauri::command]
pub(crate) async fn playback_set_background(
    enabled: bool,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    let controller = controller.inner().clone();
    blocking(move || {
        controller
            .request(Action::BackgroundPlayback(enabled))
            .map(|_| ())
    })
    .await
}
use crate::{
    music::types,
    playback::{Action, PlaybackController, QueueInput, Snapshot},
};

#[tauri::command]
pub(crate) async fn playback_set_auto_advance(
    enabled: bool,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    let controller = controller.inner().clone();
    blocking(move || {
        let _guard = crate::library::transaction()?;
        crate::library::write_auto_advance(enabled)?;
        controller.request(Action::AutoAdvance(enabled)).map(|_| ())
    })
    .await
}
#[tauri::command]
pub(crate) async fn playback_load(
    id: String,
    context: Option<QueueInput>,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<types::PlaybackPlan, String> {
    Ok(
        control(controller.inner().clone(), Action::Load(id, context))
            .await?
            .plan,
    )
}

#[tauri::command]
pub(crate) async fn playback_previous(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(controller.inner().clone(), Action::Previous)
        .await
        .map(|_| ())
}

#[tauri::command]
pub(crate) async fn playback_next(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(controller.inner().clone(), Action::Next)
        .await
        .map(|_| ())
}

#[tauri::command]
pub(crate) async fn playback_set_shuffle(
    enabled: bool,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(controller.inner().clone(), Action::Shuffle(enabled))
        .await
        .map(|_| ())
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
