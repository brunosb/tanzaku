use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
pub(crate) fn save_json<T: Serialize + ?Sized>(file: &Path, value: &T) -> Result<(), String> {
    let parent = file.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if file.exists() {
        let _: serde_json::Value = read_json(file.to_owned())?;
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut temp, value).map_err(|e| e.to_string())?;
    temp.write_all(b"\n").map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(file)
        .map_err(|e| format!("Não foi possível salvar {}: {e}", file.display()))?;
    Ok(())
}

pub(crate) fn read_json<T: for<'de> Deserialize<'de> + Default>(
    file: PathBuf,
) -> Result<T, String> {
    match fs::read(&file) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
            format!(
                "JSON inválido em {}: {e}. O arquivo foi preservado.",
                file.display()
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(format!("Não foi possível ler {}: {e}", file.display())),
    }
}
