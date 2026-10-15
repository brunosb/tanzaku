use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use tauri::{AppHandle, Emitter};

use crate::{storage, transcription};

fn progress(app: &AppHandle, stage: &str, percent: f64) {
    let _ = app.emit(
        "youtube-progress",
        serde_json::json!({ "stage": stage, "percent": percent }),
    );
}

fn run(command: &str, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new(command)
        .args(args)
        .output()
        .map_err(|error| format!("Não foi possível executar {command}: {error}"))
        .and_then(|output| {
            if output.status.success() {
                Ok(output)
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("{command} terminou com erro: {}", stderr.trim()))
            }
        })
}

fn output_text(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

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

pub fn add_youtube(app: &AppHandle, source_url: &str) -> Result<storage::LibraryEntry, String> {
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

    let root = std::env::temp_dir().join(format!("tanzaku-youtube-{}", std::process::id()));
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let result = (|| {
        progress(app, "Obtendo informações do vídeo", 0.0);
        let metadata = run(
            "yt-dlp",
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

        progress(app, "Baixando áudio", 0.0);
        let pattern = root.join("audio.%(ext)s");
        let pattern = pattern.to_string_lossy().into_owned();
        run(
            "yt-dlp",
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
        let source_audio = find_downloaded_audio(&root)?;

        progress(app, "Convertendo para WAV", 0.0);
        let wav = root.join("audio.wav");
        let source_audio = source_audio.to_string_lossy().into_owned();
        let wav_text = wav.to_string_lossy().into_owned();
        run(
            "ffmpeg",
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

        progress(app, "Transcrevendo para MIDI", 0.0);
        let midi = root.join("transcribed.mid");
        transcription::transcribe_wav_for_app(app, &wav, &midi)?;
        let entry = storage::save_transcribed_midi(&midi, title, source_url)?;
        progress(app, "Concluído", 100.0);
        Ok(entry)
    })();
    let _ = fs::remove_dir_all(&root);
    result
}
