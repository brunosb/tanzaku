use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

fn is_windows_x64_pe(path: &Path) -> bool {
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
        && u16::from_le_bytes([pe_header[4], pe_header[5]]) == 0x8664
}

fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.starts_with("x86_64-pc-windows-") {
        let ffmpeg = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("bin")
            .join("ffmpeg.exe");
        if !is_windows_x64_pe(&ffmpeg) {
            panic!(
                "{} não é um executável Windows x64 válido (o checkout pode conter apenas o ponteiro Git LFS). Execute `git lfs pull` ou, se o objeto já estiver no cache, `git lfs checkout -- src-tauri/bin/ffmpeg.exe` antes de compilar.",
                ffmpeg.display()
            );
        }
    }
    tauri_build::build()
}
