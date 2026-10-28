use super::{
    jobs::Job,
    process::{output_text, run},
    tools::tool_path,
};
use crate::{library as storage, transcription};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;
fn find_downloaded_audio(root: &Path) -> Result<PathBuf, String> {
    fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("webm" | "m4a" | "mp4" | "opus" | "wav")
            )
        })
        .ok_or_else(|| "O vídeo não forneceu uma faixa de áudio compatível.".to_string())
}

pub fn add_youtube(
    app: &AppHandle,
    source_url: &str,
    job: Job,
) -> Result<storage::LibraryEntry, String> {
    let parsed = url::Url::parse(source_url).map_err(|_| "URL inválida do YouTube.".to_string())?;
    if !matches!(
        parsed.host_str(),
        Some("youtube.com" | "www.youtube.com" | "youtu.be")
    ) {
        return Err("Informe uma URL válida do YouTube.".to_string());
    }
    if parsed.query_pairs().any(|(key, _)| key == "list") {
        return Err("URLs de playlist não são suportadas.".to_string());
    }

    let expected_root = {
        let _guard = storage::transaction()?;
        storage::storage_root()?
    };
    let temp = tempfile::Builder::new()
        .prefix("tanzaku-youtube-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let root = temp.path();
    let result = (|| {
        let yt_dlp = tool_path(app, "yt-dlp.exe")?;
        let ffmpeg = tool_path(app, "ffmpeg.exe")?;
        run(&job, &ffmpeg, &["-version"])
            .map_err(|error| format!("O FFmpeg selecionado não pôde ser executado: {error}"))?;
        job.progress(app, "Obtendo informações do vídeo", 0.0);
        let metadata = run(
            &job,
            &yt_dlp,
            &[
                "--no-playlist",
                "--print",
                "%(title)s",
                "--skip-download",
                source_url,
            ],
        )?;
        let title = output_text(&metadata);
        let title = title.lines().last().unwrap_or("Música do YouTube").trim();
        let title = if title.is_empty() {
            "Música do YouTube"
        } else {
            title
        };

        job.progress(app, "Baixando áudio", 0.0);
        let pattern = root.join("audio.%(ext)s");
        let pattern = pattern.to_string_lossy().into_owned();
        run(
            &job,
            &yt_dlp,
            &[
                "--no-playlist",
                "--no-warnings",
                "-f",
                "bestaudio/best",
                "-o",
                &pattern,
                source_url,
            ],
        )?;
        let source_audio = find_downloaded_audio(root)?;

        job.progress(app, "Convertendo para WAV", 0.0);
        let wav = root.join("audio.wav");
        let source_audio = source_audio.to_string_lossy().into_owned();
        let wav_text = wav.to_string_lossy().into_owned();
        run(
            &job,
            &ffmpeg,
            &[
                "-y",
                "-i",
                &source_audio,
                "-vn",
                "-ac",
                "1",
                "-ar",
                "22050",
                &wav_text,
            ],
        )?;

        job.progress(app, "Transcrevendo para MIDI", 0.0);
        let midi = root.join("transcribed.mid");
        let summary =
            transcription::transcribe_wav_cancellable(app, &wav, &midi, |done, total| {
                job.check()?;
                job.progress(
                    app,
                    "Transcrevendo para MIDI",
                    done as f64 / total.max(1) as f64 * 100.0,
                );
                Ok(())
            })?;
        if summary.notes == 0 {
            return Err("Não foram detectadas notas no áudio.".to_string());
        }
        let _guard = storage::transaction()?;
        job.check()?;
        if storage::storage_root()? != expected_root {
            return Err("A pasta mudou; conversão cancelada.".to_string());
        }
        let entry = storage::save_transcribed_midi(&midi, title, source_url)?;
        job.progress(app, "Concluído", 100.0);
        Ok(entry)
    })();
    result
}
