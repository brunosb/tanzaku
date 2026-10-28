use super::blocking;
use crate::transcription;
#[tauri::command]
pub(crate) async fn transcription_model_info(
    app: tauri::AppHandle,
) -> Result<transcription::ModelInfo, String> {
    blocking(move || transcription::inspect_for_app(&app)).await
}

#[tauri::command]

pub(crate) async fn transcription_infer_wav(
    app: tauri::AppHandle,
    path: String,
) -> Result<transcription::InferenceSummary, String> {
    blocking(move || transcription::infer_wav_for_app(&app, std::path::Path::new(&path))).await
}

#[tauri::command]

pub(crate) async fn transcription_wav_to_midi(
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
