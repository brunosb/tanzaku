use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
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

pub(super) fn tool_path(app: &AppHandle, name: &str) -> Result<String, String> {
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
