use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Command,
};

use tauri::{AppHandle, Emitter, Manager};

use crate::{storage, transcription};

#[derive(Clone, Default)]
pub struct Jobs(std::sync::Arc<(std::sync::Mutex<JobState>, std::sync::Condvar)>);
#[derive(Default)]
struct JobState {
    active: Option<(String, std::sync::Arc<std::sync::atomic::AtomicBool>)>,
    canceled: std::collections::VecDeque<String>,
    shutting_down: bool,
}
pub struct Job {
    id: String,
    canceled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    jobs: Jobs,
}
impl Jobs {
    pub fn start(&self, id: String) -> Result<Job, String> {
        if id.is_empty() || id.len() > 100 {
            return Err("Identificador de operação inválido.".to_string());
        }
        let mut state = self.0 .0.lock().map_err(|e| e.to_string())?;
        if state.shutting_down || state.canceled.contains(&id) {
            return Err("Conversão cancelada.".to_string());
        }
        if state.active.is_some() {
            return Err(
                "Já existe uma conversão em andamento. Aguarde seu encerramento.".to_string(),
            );
        }
        let canceled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        state.active = Some((id.clone(), canceled.clone()));
        Ok(Job {
            id,
            canceled,
            jobs: self.clone(),
        })
    }
    pub fn cancel(&self, id: &str) {
        if let Ok(mut state) = self.0 .0.lock() {
            if let Some((active, cancel)) = &state.active {
                if active == id {
                    cancel.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            }
            state.canceled.push_back(id.to_owned());
            while state.canceled.len() > 64 {
                state.canceled.pop_front();
            }
        }
    }
    pub fn cancel_all(&self) {
        if let Ok(state) = self.0 .0.lock() {
            if let Some((_, cancel)) = &state.active {
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
    }
    pub fn shutdown(&self) {
        if let Ok(mut state) = self.0 .0.lock() {
            state.shutting_down = true;
            if let Some((_, cancel)) = &state.active {
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            }
            // Give process cancellation and temporary-directory cleanup time to
            // finish before the desktop process exits.
            let _ = self
                .0
                 .1
                .wait_timeout_while(state, std::time::Duration::from_secs(10), |s| {
                    s.active.is_some()
                });
        }
    }
}
impl Job {
    pub fn check(&self) -> Result<(), String> {
        if self.canceled.load(std::sync::atomic::Ordering::SeqCst) {
            Err("Conversão cancelada.".to_string())
        } else {
            Ok(())
        }
    }
    fn progress(&self, app: &AppHandle, stage: &str, percent: f64) {
        let _ = app.emit(
            "youtube-progress",
            serde_json::json!({"jobId":self.id,"stage":stage,"percent":percent}),
        );
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        if let Ok(mut state) = self.jobs.0 .0.lock() {
            if state.active.as_ref().is_some_and(|(id, _)| id == &self.id) {
                state.active = None;
                self.jobs.0 .1.notify_all();
            }
        }
    }
}
fn run(job: &Job, command: &str, args: &[&str]) -> Result<std::process::Output, String> {
    use std::io::Read;
    job.check()?;
    let mut command_builder = Command::new(command);
    command_builder
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command_builder.creation_flags(0x08000000);
    }
    let mut child = command_builder
        .spawn()
        .map_err(|e| format!("Não foi possível executar {command}: {e}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Saída do processo indisponível.")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("Erro do processo indisponível.")?;
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let mut canceled = false;
    let status = loop {
        if job.check().is_err() {
            canceled = true;
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .output();
            }
            let _ = child.kill();
            break child.wait().map_err(|e| e.to_string())?;
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    let stdout = out
        .join()
        .map_err(|_| "Falha ao ler saída.".to_string())?
        .map_err(|e| e.to_string())?;
    let stderr = err
        .join()
        .map_err(|_| "Falha ao ler erro.".to_string())?
        .map_err(|e| e.to_string())?;
    if canceled {
        return Err("Conversão cancelada.".to_string());
    }
    let output = std::process::Output {
        status,
        stdout,
        stderr,
    };
    if output.status.success() {
        Ok(output)
    } else {
        Err(format!(
            "{command} terminou com erro: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn output_text(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

const PE_MACHINE_AMD64: u16 = 0x8664;

fn is_windows_x64_executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() < 70 {
        return false;
    }
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut dos_header = [0_u8; 64];
    if file.read_exact(&mut dos_header).is_err() || &dos_header[..2] != b"MZ" {
        return false;
    }
    let pe_offset = u32::from_le_bytes([
        dos_header[0x3c],
        dos_header[0x3d],
        dos_header[0x3e],
        dos_header[0x3f],
    ]) as u64;
    if pe_offset.saturating_add(6) > metadata.len()
        || file.seek(SeekFrom::Start(pe_offset)).is_err()
    {
        return false;
    }
    let mut pe_header = [0_u8; 6];
    file.read_exact(&mut pe_header).is_ok()
        && &pe_header[..4] == b"PE\0\0"
        && u16::from_le_bytes([pe_header[4], pe_header[5]]) == PE_MACHINE_AMD64
}

fn is_lfs_pointer(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let prefix = b"version https://git-lfs.github.com/spec/v1\n";
    let mut header = vec![0_u8; prefix.len()];
    file.read_exact(&mut header).is_ok() && header == prefix
}

fn select_ffmpeg_candidate(
    configured: Option<PathBuf>,
    resource: Option<PathBuf>,
    development: Option<PathBuf>,
    path_candidates: Vec<PathBuf>,
) -> Result<PathBuf, String> {
    let candidates = configured
        .into_iter()
        .chain(resource)
        .chain(development)
        .chain(path_candidates);
    let mut saw_lfs_pointer = false;
    for candidate in candidates {
        if is_windows_x64_executable(&candidate) {
            return Ok(candidate);
        }
        saw_lfs_pointer |= is_lfs_pointer(&candidate);
    }

    if saw_lfs_pointer {
        Err(concat!(
            "O FFmpeg encontrado é apenas um ponteiro Git LFS, não um executável. ",
            "Execute `git lfs pull` ou, se o objeto já estiver no cache, ",
            "`git lfs checkout -- src-tauri/bin/ffmpeg.exe`. Também é possível ",
            "configurar TANZAKU_FFMPEG para um executável Windows x64 válido."
        )
        .to_string())
    } else {
        Err(concat!(
            "Não foi encontrado um FFmpeg Windows x64 válido. Configure ",
            "TANZAKU_FFMPEG ou instale FFmpeg x64 no PATH."
        )
        .to_string())
    }
}

fn ffmpeg_path_candidates() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|directory| directory.join("ffmpeg.exe"))
        .collect()
}

fn ffmpeg_path(app: &AppHandle) -> Result<String, String> {
    let configured = std::env::var_os("TANZAKU_FFMPEG").map(PathBuf::from);
    let resource = app
        .path()
        .resource_dir()
        .ok()
        .map(|directory| directory.join("bin").join("ffmpeg.exe"));
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bin")
        .join("ffmpeg.exe");
    select_ffmpeg_candidate(
        configured,
        resource,
        Some(development),
        ffmpeg_path_candidates(),
    )
    .map(|path| path.to_string_lossy().into_owned())
}

fn tool_path(app: &AppHandle, name: &str) -> Result<String, String> {
    if name == "ffmpeg.exe" {
        return ffmpeg_path(app);
    }
    let variable = if name == "yt-dlp.exe" {
        "TANZAKU_YTDLP"
    } else {
        "TANZAKU_FFMPEG"
    };
    if let Ok(path) = std::env::var(variable) {
        if Path::new(&path).is_file() {
            return Ok(path);
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("bin").join(name);
        if path.is_file() {
            return Ok(path.to_string_lossy().into_owned());
        }
    }
    let development_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bin")
        .join(name);
    if development_path.is_file() {
        return Ok(development_path.to_string_lossy().into_owned());
    }
    Ok(name.to_string())
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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicUsize, Ordering},
    };

    use super::{is_lfs_pointer, is_windows_x64_executable, select_ffmpeg_candidate};

    static NEXT_TEMP: AtomicUsize = AtomicUsize::new(0);

    fn temp_path(name: &str) -> PathBuf {
        let id = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("tanzaku-ffmpeg-test-{}-{id}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    fn cleanup(path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    fn fake_pe(machine: u16) -> Vec<u8> {
        let mut bytes = vec![0_u8; 128];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&64_u32.to_le_bytes());
        bytes[64..68].copy_from_slice(b"PE\0\0");
        bytes[68..70].copy_from_slice(&machine.to_le_bytes());
        bytes
    }

    #[test]
    fn validates_windows_x64_pe_and_rejects_wrong_architecture() {
        let valid = temp_path("ffmpeg-valid.exe");
        let wrong_arch = temp_path("ffmpeg-x86.exe");
        fs::write(&valid, fake_pe(0x8664)).unwrap();
        fs::write(&wrong_arch, fake_pe(0x014c)).unwrap();

        assert!(is_windows_x64_executable(&valid));
        assert!(!is_windows_x64_executable(&wrong_arch));

        cleanup(&valid);
        cleanup(&wrong_arch);
    }

    #[test]
    fn identifies_lfs_pointer_and_does_not_select_it() {
        let pointer = temp_path("ffmpeg-pointer.exe");
        let path_copy = temp_path("ffmpeg-path.exe");
        let valid = temp_path("ffmpeg-resource.exe");
        fs::write(
            &pointer,
            b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 105423872\n",
        )
        .unwrap();
        fs::write(&path_copy, fake_pe(0x8664)).unwrap();
        fs::write(&valid, fake_pe(0x8664)).unwrap();

        assert!(is_lfs_pointer(&pointer));
        let selected = select_ffmpeg_candidate(
            Some(pointer.clone()),
            Some(valid.clone()),
            None,
            vec![path_copy],
        )
        .unwrap();
        assert_eq!(selected, valid);

        let configured = temp_path("ffmpeg-configured.exe");
        fs::write(&configured, fake_pe(0x8664)).unwrap();
        let selected =
            select_ffmpeg_candidate(Some(configured.clone()), Some(valid.clone()), None, vec![])
                .unwrap();
        assert_eq!(selected, configured);

        cleanup(&pointer);
        cleanup(&valid);
        cleanup(&configured);
    }

    #[test]
    fn falls_back_to_path_and_reports_missing_lfs_object() {
        let pointer = temp_path("ffmpeg-pointer.exe");
        let from_path = temp_path("ffmpeg-on-path.exe");
        fs::write(
            &pointer,
            b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 105423872\n",
        )
        .unwrap();
        fs::write(&from_path, fake_pe(0x8664)).unwrap();

        let selected =
            select_ffmpeg_candidate(None, Some(pointer.clone()), None, vec![from_path.clone()])
                .unwrap();
        assert_eq!(selected, from_path);

        let error = select_ffmpeg_candidate(None, Some(pointer.clone()), None, vec![]).unwrap_err();
        assert!(error.contains("git lfs checkout"));
        assert!(error.contains("TANZAKU_FFMPEG"));

        cleanup(&pointer);
        cleanup(&from_path);
    }
}

#[cfg(test)]
mod job_tests {
    use super::*;
    #[test]
    fn only_one_job_can_run_and_cancellation_is_scoped() {
        let jobs = Jobs::default();
        let job = jobs.start("a".into()).unwrap();
        assert!(jobs.start("b".into()).is_err());
        jobs.cancel("other");
        assert!(job.check().is_ok());
        jobs.cancel("a");
        assert!(job.check().is_err());
        drop(job);
        assert!(jobs.start("b".into()).is_ok());
    }
    #[test]
    fn cancellation_before_start_and_shutdown_are_respected() {
        let jobs = Jobs::default();
        jobs.cancel("a");
        assert!(jobs.start("a".into()).is_err());
        let job = jobs.start("b".into()).unwrap();
        jobs.cancel_all();
        assert!(job.check().is_err());
    }
    #[cfg(windows)]
    #[test]
    fn canceled_child_process_is_reaped() {
        let jobs = Jobs::default();
        let job = jobs.start("process".into()).unwrap();
        let cancel = jobs.clone();
        let thread = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            cancel.cancel("process");
        });
        let start = std::time::Instant::now();
        let result = run(&job, "cmd.exe", &["/C", "ping -n 10 127.0.0.1 > NUL"]);
        thread.join().unwrap();
        assert!(result.unwrap_err().contains("cancelada"));
        assert!(start.elapsed() < std::time::Duration::from_secs(3));
    }
}

#[cfg(test)]
mod shutdown_tests {
    use super::*;
    #[test]
    fn shutdown_waits_for_job_cleanup_and_rejects_new_jobs() {
        let jobs = Jobs::default();
        let job = jobs.start("shutdown".into()).unwrap();
        let cleanup = std::thread::spawn(move || {
            while job.check().is_ok() {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
            drop(job);
        });
        jobs.shutdown();
        assert!(jobs.0 .0.lock().unwrap().active.is_none());
        assert!(jobs.start("late".into()).is_err());
        cleanup.join().unwrap();
    }
}
