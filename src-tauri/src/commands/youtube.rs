use super::blocking;
use crate::{library as storage, youtube};
#[tauri::command]
pub(crate) async fn library_add_youtube(
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

pub(crate) async fn youtube_cancel(
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
