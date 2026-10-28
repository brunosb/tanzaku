use super::inference::RUNTIME_RESOURCE_PATH;
use ort::environment::Environment;
use std::{path::Path, sync::OnceLock};
static ONNX_ENVIRONMENT: OnceLock<Result<Environment, String>> = OnceLock::new();

pub(super) fn environment_for_model(model_path: &Path) -> Result<Environment, String> {
    ONNX_ENVIRONMENT
        .get_or_init(|| {
            let runtime_path = model_path
                .parent()
                .and_then(Path::parent)
                .map(|root| root.join(RUNTIME_RESOURCE_PATH));
            match runtime_path.filter(|runtime| runtime.is_file()) {
                Some(runtime) => ort::init_from(runtime)
                    .map_err(|error| format!("Falha ao carregar ONNX Runtime nativo: {error}"))?
                    .with_name("tanzaku-basic-pitch")
                    .build(),
                None => ort::init().with_name("tanzaku-basic-pitch").build(),
            }
            .map_err(|error| format!("Falha ao iniciar ONNX Runtime: {error}"))
        })
        .clone()
}
