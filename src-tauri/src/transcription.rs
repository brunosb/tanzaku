use ort::{session::Session, value::ValueType};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MODEL_RESOURCE_PATH: &str = "models/nmp.onnx";
const RUNTIME_RESOURCE_PATH: &str = "runtime/onnxruntime.dll";

#[derive(Debug, Serialize)]
pub struct TensorInfo {
    pub name: String,
    pub data_type: String,
    pub shape: String,
}

#[derive(Debug, Serialize)]
pub struct ModelInfo {
    pub model: String,
    pub path: String,
    pub size_bytes: u64,
    pub inputs: Vec<TensorInfo>,
    pub outputs: Vec<TensorInfo>,
}

pub fn inspect_for_app(app: &tauri::AppHandle) -> Result<ModelInfo, String> {
    let path = locate_model(app)?;
    inspect_model(&path)
}

fn locate_model(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("TANZAKU_BASIC_PITCH_MODEL") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join(MODEL_RESOURCE_PATH);
        if path.is_file() {
            return Ok(path);
        }
    }

    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(MODEL_RESOURCE_PATH);
    if path.is_file() {
        return Ok(path);
    }

    Err(format!(
        "Modelo Basic Pitch não encontrado. Caminho esperado: {}",
        path.display()
    ))
}

fn inspect_model(path: &Path) -> Result<ModelInfo, String> {
    let size_bytes = std::fs::metadata(path)
        .map_err(|error| format!("Não foi possível ler o modelo: {error}"))?
        .len();

    let runtime_path = path
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join(RUNTIME_RESOURCE_PATH));
    let environment = match runtime_path.filter(|runtime| runtime.is_file()) {
        Some(runtime) => ort::init_from(runtime)
            .map_err(|error| format!("Falha ao carregar ONNX Runtime nativo: {error}"))?
            .with_name("tanzaku-basic-pitch")
            .build(),
        None => ort::init().with_name("tanzaku-basic-pitch").build(),
    }
    .map_err(|error| format!("Falha ao iniciar ONNX Runtime: {error}"))?;
    let session = Session::builder(&environment)
        .map_err(|error| format!("Falha ao criar sessão ONNX: {error}"))?
        .commit_from_file(path)
        .map_err(|error| format!("Falha ao abrir o modelo ONNX: {error}"))?;

    Ok(ModelInfo {
        model: "Basic Pitch / icassp_2022 / nmp.onnx".to_string(),
        path: path.display().to_string(),
        size_bytes,
        inputs: session.inputs().iter().map(tensor_info).collect(),
        outputs: session.outputs().iter().map(tensor_info).collect(),
    })
}

fn tensor_info(outlet: &ort::value::Outlet) -> TensorInfo {
    let (data_type, shape) = match outlet.dtype() {
        ValueType::Tensor { ty, shape, .. } => (format!("{ty:?}"), shape.to_string()),
        value_type => (format!("{value_type:?}"), "n/a".to_string()),
    };
    TensorInfo {
        name: outlet.name().to_string(),
        data_type,
        shape,
    }
}

#[cfg(test)]
mod tests {
    use super::inspect_model;
    use std::path::PathBuf;

    #[test]
    fn basic_pitch_model_has_expected_signature() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/nmp.onnx");
        let info = inspect_model(&path).expect("Basic Pitch ONNX should load");

        assert_eq!(info.size_bytes, 230_444);
        assert_eq!(info.inputs.len(), 1);
        assert_eq!(info.outputs.len(), 3);
        assert!(info.inputs[0].name.contains("input"));
        assert!(info.outputs.iter().any(|output| output.name.contains(":0")));
    }
}
