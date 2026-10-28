mod audio;

mod decoder;

mod input;

mod midi;

mod planner;

mod playback;

mod storage;

mod timing;

mod transcription;

mod youtube;

use tauri::Manager;

use playback::{Action, PlaybackController, Snapshot};

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

async fn control(controller: PlaybackController, action: Action) -> Result<Snapshot, String> {
    let reply = controller.enqueue(action)?;
    blocking(move || reply.recv().map_err(|e| e.to_string())?).await
}

#[tauri::command]

async fn library_list() -> Result<Vec<storage::LibraryEntry>, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::read_library()
    })
    .await
}

#[tauri::command]

async fn library_import() -> Result<Option<storage::LibraryEntry>, String> {
    blocking(|| {
        let Some(source) = rfd::FileDialog::new()
            .add_filter("MIDI", &["mid", "midi"])
            .pick_file()
        else {
            return Ok(None);
        };
        let _guard = storage::transaction()?;
        storage::import_midi(&source).map(Some)
    })
    .await
}

#[tauri::command]

async fn library_rename(
    id: String,
    title: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<storage::LibraryEntry, String> {
    let controller = controller.inner().clone();
    blocking(move || {
        let entry = {
            let _guard = storage::transaction()?;
            storage::rename_midi(&id, &title)?
        };
        controller.request(Action::Rename(entry.id.clone(), entry.title.clone()))?;
        Ok(entry)
    })
    .await
}

#[tauri::command]

async fn library_delete(
    id: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<Vec<storage::LibraryEntry>, String> {
    let controller = controller.inner().clone();
    blocking(move || {
        let _guard = storage::transaction()?;
        let _ = storage::read_playlists()?;
        let _ = storage::read_library()?;
        controller.request(Action::Remove(id.clone()))?;
        storage::delete_midi(&id)
    })
    .await
}

#[tauri::command]

async fn playback_load(
    id: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<planner::PlaybackPlan, String> {
    Ok(control(controller.inner().clone(), Action::Load(id))
        .await?
        .plan)
}

#[tauri::command]

async fn playback_start(controller: tauri::State<'_, PlaybackController>) -> Result<(), String> {
    control(controller.inner().clone(), Action::Play)
        .await
        .map(|_| ())
}

#[tauri::command]

async fn playback_pause(controller: tauri::State<'_, PlaybackController>) -> Result<(), String> {
    control(controller.inner().clone(), Action::Pause)
        .await
        .map(|_| ())
}

#[tauri::command]

async fn playback_stop(controller: tauri::State<'_, PlaybackController>) -> Result<(), String> {
    control(controller.inner().clone(), Action::Stop)
        .await
        .map(|_| ())
}

#[tauri::command]

async fn playback_seek(
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

async fn playback_set_speed(
    speed: f64,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(controller.inner().clone(), Action::Speed(speed))
        .await
        .map(|_| ())
}

#[tauri::command]

async fn playback_toggle_repeat(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<bool, String> {
    Ok(control(controller.inner().clone(), Action::Repeat)
        .await?
        .state
        .repeat_enabled)
}

#[tauri::command]

async fn playback_get_snapshot(
    controller: tauri::State<'_, PlaybackController>,
) -> Result<Snapshot, String> {
    control(controller.inner().clone(), Action::Snapshot).await
}

#[tauri::command]

async fn playlist_list() -> Result<Vec<storage::Playlist>, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::read_playlists()
    })
    .await
}

fn valid_name(name: &str) -> Result<String, String> {
    let name = name.trim().chars().take(100).collect::<String>();
    if name.is_empty() {
        Err("Nome inválido.".to_string())
    } else {
        Ok(name)
    }
}

#[tauri::command]

async fn playlist_create(name: String) -> Result<storage::Playlist, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        let name = valid_name(&name)?;
        let mut lists = storage::read_playlists()?;
        let playlist = storage::Playlist {
            id: storage::new_id("playlist"),
            name,
            track_ids: vec![],
            created_at: storage::new_id("created"),
        };
        lists.push(playlist.clone());
        storage::write_playlists(&lists)?;
        Ok(playlist)
    })
    .await
}

#[tauri::command]

async fn playlist_rename(id: String, name: String) -> Result<storage::Playlist, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        let mut lists = storage::read_playlists()?;
        let p = lists
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or("Playlist não encontrada.")?;
        p.name = valid_name(&name)?;
        let result = p.clone();
        storage::write_playlists(&lists)?;
        Ok(result)
    })
    .await
}

#[tauri::command]

async fn playlist_delete(id: String) -> Result<Vec<storage::Playlist>, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        let mut lists = storage::read_playlists()?;
        lists.retain(|p| p.id != id);
        storage::write_playlists(&lists)?;
        Ok(lists)
    })
    .await
}

#[tauri::command]

async fn playlist_add(playlist_id: String, track_id: String) -> Result<storage::Playlist, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        if !storage::read_library()?.iter().any(|e| e.id == track_id) {
            return Err("Música não encontrada.".to_string());
        }
        let mut lists = storage::read_playlists()?;
        let p = lists
            .iter_mut()
            .find(|p| p.id == playlist_id)
            .ok_or("Playlist não encontrada.")?;
        if !p.track_ids.contains(&track_id) {
            p.track_ids.push(track_id);
        }
        let result = p.clone();
        storage::write_playlists(&lists)?;
        Ok(result)
    })
    .await
}

#[tauri::command]

async fn playlist_remove_track(
    playlist_id: String,
    track_id: String,
) -> Result<storage::Playlist, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        let mut lists = storage::read_playlists()?;
        let p = lists
            .iter_mut()
            .find(|p| p.id == playlist_id)
            .ok_or("Playlist não encontrada.")?;
        p.track_ids.retain(|t| t != &track_id);
        let result = p.clone();
        storage::write_playlists(&lists)?;
        Ok(result)
    })
    .await
}

#[tauri::command]
async fn playlist_add_tracks(
    playlist_id: String,
    track_ids: Vec<String>,
) -> Result<storage::Playlist, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::add_playlist_tracks(&playlist_id, &track_ids)
    })
    .await
}

#[tauri::command]
async fn playlist_reorder(
    playlist_id: String,
    track_ids: Vec<String>,
) -> Result<storage::Playlist, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::reorder_playlist(&playlist_id, &track_ids)
    })
    .await
}

#[tauri::command]

async fn playlist_play(
    id: String,
    mode: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(
        controller.inner().clone(),
        Action::Playlist(id, mode == "shuffle"),
    )
    .await
    .map(|_| ())
}

fn set_directory(
    mut root: std::path::PathBuf,
    controller: &PlaybackController,
    jobs: &youtube::Jobs,
) -> Result<Option<String>, String> {
    let _guard = storage::transaction()?;

    if root.as_os_str().is_empty() {
        return Ok(None);
    }

    if root.file_name().is_some_and(|n| n == "midi")
        && root
            .parent()
            .is_some_and(|p| p.join("library.json").is_file())
    {
        root = root.parent().unwrap().to_owned();
    }

    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;

    let _: Vec<storage::LibraryEntry> = storage::read_json(root.join("library.json"))?;

    let _: Vec<storage::Playlist> = storage::read_json(root.join("playlists.json"))?;

    let mut settings: serde_json::Value = storage::read_json(root.join("settings.json"))?;

    if settings.is_null() {
        settings = serde_json::json!({});
    }
    if !settings.is_object() {
        return Err("Configurações inválidas.".to_string());
    }

    jobs.cancel_all();
    controller.request(Action::Clear)?;

    std::fs::create_dir_all(root.join("midi")).map_err(|e| e.to_string())?;

    storage::write_settings_at(&root, settings)?;

    for base in [dirs::data_dir(), dirs::config_dir()].into_iter().flatten() {
        let pointer = base.join("Tanzaku");
        if pointer != root {
            let mut value: serde_json::Value = storage::read_json(pointer.join("settings.json"))?;
            if value.is_null() {
                value = serde_json::json!({});
            }
            if !value.is_object() {
                return Err("Configurações inválidas.".to_string());
            }
            value["storageRoot"] = serde_json::json!(root.to_string_lossy());
            storage::save_json(&pointer.join("settings.json"), &value)?;
        }
    }

    storage::set_storage_root(root.clone());
    Ok(Some(root.to_string_lossy().into_owned()))
}

#[tauri::command]

async fn storage_choose_directory(
    controller: tauri::State<'_, PlaybackController>,
    jobs: tauri::State<'_, youtube::Jobs>,
) -> Result<Option<String>, String> {
    let controller = controller.inner().clone();
    let jobs = jobs.inner().clone();
    blocking(move || {
        let Some(root) = rfd::FileDialog::new()
            .set_title("Armazenamento do Tanzaku")
            .pick_folder()
        else {
            return Ok(None);
        };
        set_directory(root, &controller, &jobs)
    })
    .await
}

#[tauri::command]

async fn storage_set_directory(
    path: String,
    controller: tauri::State<'_, PlaybackController>,
    jobs: tauri::State<'_, youtube::Jobs>,
) -> Result<Option<String>, String> {
    let controller = controller.inner().clone();
    let jobs = jobs.inner().clone();
    blocking(move || {
        set_directory(
            std::path::PathBuf::from(path.trim().trim_matches('"')),
            &controller,
            &jobs,
        )
    })
    .await
}

#[tauri::command]

async fn settings_get() -> Result<serde_json::Value, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::read_settings()
    })
    .await
}

#[tauri::command]

async fn settings_update(value: serde_json::Value) -> Result<serde_json::Value, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        let mut settings = storage::read_settings()?;
        if let Some(next) = value.as_object() {
            for (key, value) in next {
                if key != "storageRoot" {
                    settings[key] = value.clone();
                }
            }
        }
        storage::write_settings_at(&storage::storage_root()?, settings.clone())?;
        Ok(settings)
    })
    .await
}

#[tauri::command]

async fn transcription_model_info(
    app: tauri::AppHandle,
) -> Result<transcription::ModelInfo, String> {
    blocking(move || transcription::inspect_for_app(&app)).await
}

#[tauri::command]

async fn transcription_infer_wav(
    app: tauri::AppHandle,
    path: String,
) -> Result<transcription::InferenceSummary, String> {
    blocking(move || transcription::infer_wav_for_app(&app, std::path::Path::new(&path))).await
}

#[tauri::command]

async fn transcription_wav_to_midi(
    app: tauri::AppHandle,
    wav_path: String,
    midi_path: String,
) -> Result<transcription::MidiTranscriptionSummary, String> {
    blocking(move || {
        transcription::transcribe_wav_for_app(
            &app,
            std::path::Path::new(&wav_path),
            std::path::Path::new(&midi_path),
        )
    })
    .await
}

#[tauri::command]

async fn library_add_youtube(
    app: tauri::AppHandle,
    url: String,
    job_id: String,
    jobs: tauri::State<'_, youtube::Jobs>,
) -> Result<storage::LibraryEntry, String> {
    let jobs = jobs.inner().clone();
    let job = jobs.start(job_id)?;
    blocking(move || youtube::add_youtube(&app, url.trim(), job)).await
}

#[tauri::command]

async fn youtube_cancel(
    job_id: String,
    jobs: tauri::State<'_, youtube::Jobs>,
) -> Result<(), String> {
    let jobs = jobs.inner().clone();
    blocking(move || {
        let _guard = storage::transaction()?;
        jobs.cancel(&job_id);
        Ok(())
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(youtube::Jobs::default());
            app.manage(PlaybackController::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_list,
            library_import,
            library_rename,
            library_delete,
            playback_load,
            playback_start,
            playback_pause,
            playback_stop,
            playback_seek,
            playback_set_speed,
            playback_get_snapshot,
            playback_toggle_repeat,
            playlist_list,
            playlist_create,
            playlist_rename,
            playlist_delete,
            playlist_add,
            playlist_remove_track,
            playlist_add_tracks,
            playlist_reorder,
            playlist_play,
            storage_choose_directory,
            storage_set_directory,
            settings_get,
            settings_update,
            transcription_model_info,
            transcription_infer_wav,
            transcription_wav_to_midi,
            library_add_youtube,
            youtube_cancel
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
