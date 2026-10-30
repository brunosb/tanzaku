use super::tools::is_windows_x64_executable;
use pgp::composed::{Deserializable, DetachedSignature, SignedPublicKey};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager};

const KEY: &[u8] = include_bytes!("yt-dlp-public.key");
const MANIFEST: &str = include_str!("../../../tools/release/runtime-manifest.json");
const API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

fn bundled_version() -> Option<String> {
    let manifest: serde_json::Value = serde_json::from_str(MANIFEST).ok()?;
    manifest["downloads"]
        .as_array()?
        .iter()
        .find(|item| item["name"] == "yt-dlp")?["version"]
        .as_str()
        .map(str::to_owned)
}

fn version_valid(version: &str) -> bool {
    let parts: Vec<_> = version.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 4 && part.bytes().all(|b| b.is_ascii_digit())
        })
}

fn version_parts(version: &str) -> Vec<u32> {
    version
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn verify_signature(sums: &[u8], signature: &[u8]) -> Result<(), String> {
    let (key, _) = SignedPublicKey::from_armor_single(KEY).map_err(|e| e.to_string())?;
    let signature = DetachedSignature::from_bytes(signature).map_err(|e| e.to_string())?;
    if signature.verify(&key, sums).is_ok() {
        return Ok(());
    }
    for subkey in &key.public_subkeys {
        if subkey.verify_bindings(&key.primary_key).is_ok()
            && signature.verify(subkey, sums).is_ok()
        {
            return Ok(());
        }
    }
    Err("Assinatura oficial do yt-dlp inválida.".into())
}

fn expected_hash(sums: &[u8]) -> Result<&str, String> {
    let text = std::str::from_utf8(sums).map_err(|e| e.to_string())?;
    let hashes: Vec<_> = text
        .lines()
        .filter_map(|line| {
            let (hash, name) = line.split_once(char::is_whitespace)?;
            (name.trim().trim_start_matches('*') == "yt-dlp.exe").then_some(hash)
        })
        .collect();
    if hashes.len() != 1
        || hashes[0].len() != 64
        || !hashes[0].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Checksum oficial do yt-dlp inválido.".into());
    }
    Ok(hashes[0])
}

fn verified_version(dir: &Path) -> Result<PathBuf, String> {
    let sums = fs::read(dir.join("SHA2-256SUMS")).map_err(|e| e.to_string())?;
    let signature = fs::read(dir.join("SHA2-256SUMS.sig")).map_err(|e| e.to_string())?;
    verify_signature(&sums, &signature)?;
    let executable = dir.join("yt-dlp.exe");
    if !is_windows_x64_executable(&executable) {
        return Err("yt-dlp atualizado não é Windows x64.".into());
    }
    let bytes = fs::read(&executable).map_err(|e| e.to_string())?;
    let hash = format!("{:x}", Sha256::digest(bytes));
    if !hash.eq_ignore_ascii_case(expected_hash(&sums)?) {
        return Err("Hash do yt-dlp atualizado inválido.".into());
    }
    Ok(executable)
}

fn update_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = std::env::var_os("TANZAKU_DATA_DIR").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(root).join("yt-dlp-updates"));
    }
    app.path()
        .app_local_data_dir()
        .map(|p| p.join("yt-dlp-updates"))
        .map_err(|e| e.to_string())
}

pub(super) fn available_tools(app: &AppHandle) -> Vec<String> {
    let Ok(root) = update_root(app) else {
        return Vec::new();
    };
    let Some(bundled) = bundled_version() else {
        return Vec::new();
    };
    let mut tools = Vec::new();
    for pointer in ["current", "previous"] {
        let Ok(version) = fs::read_to_string(root.join(pointer)) else {
            continue;
        };
        if !version_valid(&version) || version_parts(&version) <= version_parts(&bundled) {
            continue;
        }
        if let Ok(path) = verified_version(&root.join(version)) {
            let path = path.to_string_lossy().into_owned();
            if !tools.contains(&path) {
                tools.push(path);
            }
        }
    }
    tools
}

fn write_pointer(root: &Path, name: &str, version: &str) -> Result<(), String> {
    use std::io::Write;
    let mut pointer = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    pointer
        .write_all(version.as_bytes())
        .map_err(|e| e.to_string())?;
    pointer
        .persist(root.join(name))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn fetch(client: &reqwest::blocking::Client, url: &str, limit: u64) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Resposta de atualização excedeu o limite.".into());
    }
    Ok(bytes)
}

fn update(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let stamp = root.join("last-check");
    if fs::metadata(&stamp)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|elapsed| elapsed < Duration::from_secs(86400))
    {
        return Ok(());
    }
    fs::write(&stamp, b"checked").map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("Tanzaku/1.0")
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    let release: serde_json::Value =
        serde_json::from_slice(&fetch(&client, API, 1024 * 1024)?).map_err(|e| e.to_string())?;
    let version = release["tag_name"]
        .as_str()
        .ok_or("Versão oficial indisponível.")?;
    if !version_valid(version) {
        return Err("Versão oficial inválida.".into());
    }
    let current = fs::read_to_string(root.join("current")).unwrap_or_default();
    let bundled = bundled_version().ok_or("Versão incluída do yt-dlp inválida.")?;
    let baseline = if version_valid(&current) && verified_version(&root.join(&current)).is_ok() {
        current.as_str()
    } else {
        bundled.as_str()
    };
    if version_parts(version) <= version_parts(baseline) {
        return Ok(());
    }
    let base = format!("https://github.com/yt-dlp/yt-dlp/releases/download/{version}");
    let sums = fetch(&client, &format!("{base}/SHA2-256SUMS"), 65536)?;
    let signature = fetch(&client, &format!("{base}/SHA2-256SUMS.sig"), 65536)?;
    verify_signature(&sums, &signature)?;
    let expected = expected_hash(&sums)?;
    let executable = fetch(&client, &format!("{base}/yt-dlp.exe"), 100 * 1024 * 1024)?;
    if !format!("{:x}", Sha256::digest(&executable)).eq_ignore_ascii_case(expected) {
        return Err("Hash do download não confere com a assinatura oficial.".into());
    }
    let temporary = tempfile::Builder::new()
        .prefix("download-")
        .tempdir_in(root)
        .map_err(|e| e.to_string())?;
    fs::write(temporary.path().join("yt-dlp.exe"), executable).map_err(|e| e.to_string())?;
    fs::write(temporary.path().join("SHA2-256SUMS"), sums).map_err(|e| e.to_string())?;
    fs::write(temporary.path().join("SHA2-256SUMS.sig"), signature).map_err(|e| e.to_string())?;
    let candidate = verified_version(temporary.path())?;
    let mut command = std::process::Command::new(&candidate);
    command.args([
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-update",
        "--version",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != version {
        return Err("A nova versão do yt-dlp não iniciou corretamente.".into());
    }
    let destination = root.join(version);
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|e| e.to_string())?;
    }
    fs::rename(temporary.path(), &destination).map_err(|e| e.to_string())?;
    if version_valid(&current) && verified_version(&root.join(&current)).is_ok() {
        write_pointer(root, "previous", &current)?;
    }
    write_pointer(root, "current", version)?;
    let previous = fs::read_to_string(root.join("previous")).unwrap_or_default();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if version_valid(&name) && name != version && name != previous {
                // An executable in use cannot be removed on Windows; retry next update.
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    Ok(())
}

pub(crate) fn start_update(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(error) = update_root(&app).and_then(|root| update(&root)) {
            eprintln!("Não foi possível atualizar yt-dlp; versão atual preservada: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_versions_and_hash_manifests() {
        assert!(!version_valid("../../other"));
        assert!(version_valid("2026.10.26"));
        assert!(expected_hash(b"abc  yt-dlp.exe\n").is_err());
        assert!(verify_signature(b"tampered", b"invalid").is_err());
    }
    #[test]
    fn pointer_replacement_preserves_previous_value_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        write_pointer(dir.path(), "current", "2026.10.26").unwrap();
        write_pointer(dir.path(), "current", "2026.10.27").unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("current")).unwrap(),
            "2026.10.27"
        );
        assert!(write_pointer(dir.path(), "missing/current", "2026.10.28").is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("current")).unwrap(),
            "2026.10.27"
        );
    }
    #[test]
    fn verifies_official_release_and_rejects_modified_content() {
        let sums = include_bytes!("test-data/SHA2-256SUMS");
        let signature = include_bytes!("test-data/SHA2-256SUMS.sig");
        verify_signature(sums, signature).unwrap();
        assert_eq!(
            expected_hash(sums).unwrap(),
            "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d"
        );
        let mut modified = sums.to_vec();
        modified[0] ^= 1;
        assert!(verify_signature(&modified, signature).is_err());
    }

    #[test]
    fn verifies_binary_against_signed_release_hash() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("SHA2-256SUMS"),
            include_bytes!("test-data/SHA2-256SUMS"),
        )
        .unwrap();
        fs::write(
            dir.path().join("SHA2-256SUMS.sig"),
            include_bytes!("test-data/SHA2-256SUMS.sig"),
        )
        .unwrap();
        let exe = dir.path().join("yt-dlp.exe");
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("bin/yt-dlp.exe"),
            &exe,
        )
        .unwrap();
        assert!(verified_version(dir.path()).is_ok());
        use std::io::{Seek, SeekFrom, Write};
        let mut file = fs::OpenOptions::new().write(true).open(exe).unwrap();
        file.seek(SeekFrom::End(0)).unwrap();
        file.write_all(b"tampered").unwrap();
        assert!(verified_version(dir.path()).is_err());
    }
}
