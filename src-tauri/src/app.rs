use crate::{
    commands,
    playback::{Action, PlaybackController},
    youtube,
};
use tauri::Manager;
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(youtube::Jobs::default());
            app.manage(PlaybackController::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::library_list,
            commands::library::library_import,
            commands::library::library_rename,
            commands::library::library_delete,
            commands::playback::playback_load,
            commands::playback::playback_previous,
            commands::playback::playback_next,
            commands::playback::playback_set_shuffle,
            commands::playback::playback_set_auto_advance,
            commands::playback::playback_start,
            commands::playback::playback_pause,
            commands::playback::playback_stop,
            commands::playback::playback_seek,
            commands::playback::playback_set_speed,
            commands::playback::playback_get_snapshot,
            commands::playback::playback_toggle_repeat,
            commands::playlists::playlist_list,
            commands::playlists::playlist_create,
            commands::playlists::playlist_rename,
            commands::playlists::playlist_delete,
            commands::playlists::playlist_add,
            commands::playlists::playlist_remove_track,
            commands::playlists::playlist_add_tracks,
            commands::playlists::playlist_reorder,
            commands::playlists::playlist_play,
            commands::settings::storage_choose_directory,
            commands::settings::storage_set_directory,
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::transcription::transcription_model_info,
            commands::transcription::transcription_infer_wav,
            commands::transcription::transcription_wav_to_midi,
            commands::youtube::library_add_youtube,
            commands::youtube::youtube_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("Falha ao iniciar Tanzaku")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app.state::<youtube::Jobs>().cancel_all();
                let _ = app.state::<PlaybackController>().request(Action::Shutdown);
                app.state::<youtube::Jobs>().shutdown();
            }
        });
}
