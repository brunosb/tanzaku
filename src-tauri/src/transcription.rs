use ort::{environment::Environment, session::Session, value::ValueType};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::Manager;

use crate::audio;

const MODEL_RESOURCE_PATH: &str = "models/nmp.onnx";
const RUNTIME_RESOURCE_PATH: &str = "runtime/onnxruntime.dll";

static ONNX_ENVIRONMENT: OnceLock<Result<Environment, String>> = OnceLock::new();

fn environment_for_model(model_path: &Path) -> Result<Environment, String> {
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
        .as_ref()
        .map(Clone::clone)
        .map_err(Clone::clone)
}

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

#[derive(Debug, Serialize)]
pub struct InferenceSummary {
    pub audio_samples: usize,
    pub windows: usize,
    pub output_frames: usize,
    pub note_shape: String,
    pub onset_shape: String,
    pub contour_shape: String,
    pub note_peak: f32,
}

#[derive(Debug, Serialize)]
pub struct MidiTranscriptionSummary {
    pub audio_samples: usize,
    pub frames: usize,
    pub notes: usize,
    pub midi_path: String,
}

pub fn inspect_for_app(app: &tauri::AppHandle) -> Result<ModelInfo, String> {
    let path = locate_model(app)?;
    inspect_model(&path)
}

pub fn infer_wav_for_app(
    app: &tauri::AppHandle,
    wav_path: &Path,
) -> Result<InferenceSummary, String> {
    let model_path = locate_model(app)?;
    let audio = audio::read_wav(wav_path)?;
    infer_wav(&model_path, &audio.samples)
}

pub fn transcribe_wav_for_app(
    app: &tauri::AppHandle,
    wav_path: &Path,
    midi_path: &Path,
) -> Result<MidiTranscriptionSummary, String> {
    let model_path = locate_model(app)?;
    let audio = audio::read_wav(wav_path)?;
    transcribe_wav(&model_path, &audio.samples, midi_path)
}

fn transcribe_wav(
    model_path: &Path,
    samples: &[f32],
    midi_path: &Path,
) -> Result<MidiTranscriptionSummary, String> {
    use ndarray::Array3;
    use ort::value::TensorRef;

    const WINDOW: usize = 43_844;
    const OVERLAP_SAMPLES: usize = 30 * 256;
    const HOP: usize = WINDOW - OVERLAP_SAMPLES;
    const OUTPUT_FRAMES: usize = 172;
    const OUTPUT_COLS: usize = 88;

    let environment = environment_for_model(model_path)?;
    let mut session = Session::builder(&environment)
        .map_err(|error| format!("Falha ao criar sessão ONNX: {error}"))?
        .commit_from_file(model_path)
        .map_err(|error| format!("Falha ao abrir o modelo ONNX: {error}"))?;

    let mut padded = vec![0.0_f32; OVERLAP_SAMPLES / 2];
    padded.extend_from_slice(samples);
    let mut note_windows = Vec::new();
    let mut onset_windows = Vec::new();
    let mut contour_windows = Vec::new();

    for start in (0..padded.len()).step_by(HOP) {
        let mut window = vec![0.0_f32; WINDOW];
        let end = (start + WINDOW).min(padded.len());
        window[..end - start].copy_from_slice(&padded[start..end]);
        let input = Array3::from_shape_vec((1, WINDOW, 1), window)
            .map_err(|error| format!("Falha ao criar tensor de áudio: {error}"))?;
        let input = TensorRef::from_array_view(input.view())
            .map_err(|error| format!("Falha ao criar entrada ONNX: {error}"))?;
        let outputs = session
            .run(ort::inputs![input])
            .map_err(|error| format!("Falha na inferência ONNX: {error}"))?;
        note_windows.push(
            outputs["StatefulPartitionedCall:1"]
                .try_extract_array::<f32>()
                .map_err(|error| format!("Saída note inválida: {error}"))?
                .iter()
                .copied()
                .collect::<Vec<_>>(),
        );
        onset_windows.push(
            outputs["StatefulPartitionedCall:2"]
                .try_extract_array::<f32>()
                .map_err(|error| format!("Saída onset inválida: {error}"))?
                .iter()
                .copied()
                .collect::<Vec<_>>(),
        );
        contour_windows.push(
            outputs["StatefulPartitionedCall:0"]
                .try_extract_array::<f32>()
                .map_err(|error| format!("Saída contour inválida: {error}"))?
                .iter()
                .copied()
                .collect::<Vec<_>>(),
        );
    }

    let note = unwrap_windows(&note_windows, OUTPUT_FRAMES, OUTPUT_COLS, samples.len());
    let onset = unwrap_windows(&onset_windows, OUTPUT_FRAMES, OUTPUT_COLS, samples.len());
    let contour = unwrap_windows(&contour_windows, OUTPUT_FRAMES, 264, samples.len());
    let frames = note.len() / OUTPUT_COLS;
    let mut notes = crate::decoder::decode_notes(&note, &onset, frames);
    crate::decoder::add_pitch_bends(&mut notes, &contour, frames);
    crate::decoder::write_midi(midi_path, &notes)?;
    Ok(MidiTranscriptionSummary {
        audio_samples: samples.len(),
        frames,
        notes: notes.len(),
        midi_path: midi_path.display().to_string(),
    })
}

fn unwrap_windows(
    windows: &[Vec<f32>],
    window_frames: usize,
    columns: usize,
    original_samples: usize,
) -> Vec<f32> {
    let trim = 15;
    let target_frames = original_samples / 256;
    let mut output = Vec::new();
    for window in windows {
        let start = trim * columns;
        let end = (window_frames - trim) * columns;
        output.extend_from_slice(&window[start..end]);
    }
    output.truncate(target_frames * columns);
    output
}

fn infer_wav(model_path: &Path, samples: &[f32]) -> Result<InferenceSummary, String> {
    use ndarray::Array3;
    use ort::value::TensorRef;

    const WINDOW: usize = 43_844;
    const OVERLAP_FRAMES: usize = 30;
    const FFT_HOP: usize = 256;
    const OVERLAP_SAMPLES: usize = OVERLAP_FRAMES * FFT_HOP;
    const HOP: usize = WINDOW - OVERLAP_SAMPLES;

    let environment = environment_for_model(model_path)?;
    let mut session = Session::builder(&environment)
        .map_err(|error| format!("Falha ao criar sessão ONNX: {error}"))?
        .commit_from_file(model_path)
        .map_err(|error| format!("Falha ao abrir o modelo ONNX: {error}"))?;

    let mut padded = vec![0.0_f32; OVERLAP_SAMPLES / 2];
    padded.extend_from_slice(samples);
    let mut windows = 0;
    let mut output_frames = 0;
    let mut note_shape = String::new();
    let mut onset_shape = String::new();
    let mut contour_shape = String::new();
    let mut note_peak = 0.0_f32;

    for start in (0..padded.len()).step_by(HOP) {
        let mut window = vec![0.0_f32; WINDOW];
        let end = (start + WINDOW).min(padded.len());
        window[..end - start].copy_from_slice(&padded[start..end]);
        let input = Array3::from_shape_vec((1, WINDOW, 1), window)
            .map_err(|error| format!("Falha ao criar tensor de áudio: {error}"))?;
        let input = TensorRef::from_array_view(input.view())
            .map_err(|error| format!("Falha ao criar entrada ONNX: {error}"))?;
        let outputs = session
            .run(ort::inputs![input])
            .map_err(|error| format!("Falha na inferência ONNX: {error}"))?;

        let note = outputs["StatefulPartitionedCall:1"]
            .try_extract_array::<f32>()
            .map_err(|error| format!("Saída note inválida: {error}"))?;
        let onset = outputs["StatefulPartitionedCall:2"]
            .try_extract_array::<f32>()
            .map_err(|error| format!("Saída onset inválida: {error}"))?;
        let contour = outputs["StatefulPartitionedCall:0"]
            .try_extract_array::<f32>()
            .map_err(|error| format!("Saída contour inválida: {error}"))?;
        note_shape = format!("{:?}", note.shape());
        onset_shape = format!("{:?}", onset.shape());
        contour_shape = format!("{:?}", contour.shape());
        note_peak = note_peak.max(note.iter().copied().fold(0.0_f32, f32::max));
        output_frames += note.shape().get(1).copied().unwrap_or_default();
        windows += 1;
    }

    Ok(InferenceSummary {
        audio_samples: samples.len(),
        windows,
        output_frames,
        note_shape,
        onset_shape,
        contour_shape,
        note_peak,
    })
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

    let environment = environment_for_model(path)?;
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

    #[test]
    fn basic_pitch_runs_one_audio_window() {
        let model_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/nmp.onnx");
        let samples = vec![0.0_f32; 22_050 * 2];
        let summary = super::infer_wav(&model_path, &samples).expect("inference should run");

        assert_eq!(summary.audio_samples, 44_100);
        assert_eq!(summary.windows, 2);
        assert_eq!(summary.output_frames, 344);
        assert_eq!(summary.note_shape, "[1, 172, 88]");
        assert_eq!(summary.onset_shape, "[1, 172, 88]");
        assert_eq!(summary.contour_shape, "[1, 172, 264]");
    }

    #[test]
    fn shared_environment_supports_inspection_inference_and_transcription() {
        let model_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/nmp.onnx");
        let inspection = super::inspect_model(&model_path).expect("model inspection should run");
        assert_eq!(inspection.outputs.len(), 3);

        let samples = vec![0.0_f32; 22_050 * 2];
        let inference = super::infer_wav(&model_path, &samples).expect("inference should run");
        assert_eq!(inference.windows, 2);

        let midi_path = std::env::temp_dir().join(format!(
            "tanzaku-onnx-shared-environment-{}.mid",
            std::process::id()
        ));
        let transcription = super::transcribe_wav(&model_path, &samples, &midi_path)
            .expect("transcription should run");
        assert!(transcription.frames > 0);
        assert!(midi_path.is_file());
        let _ = std::fs::remove_file(midi_path);
    }

    #[test]
    fn transcribes_wav_from_environment_when_provided() {
        let Some(wav_path) = std::env::var_os("TANZAKU_TEST_WAV") else {
            return;
        };
        let output_path = std::env::temp_dir().join("tanzaku-basic-pitch-rust.mid");
        let model_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/nmp.onnx");
        let audio = crate::audio::read_wav(std::path::Path::new(&wav_path))
            .expect("test WAV should be readable");
        let summary = super::transcribe_wav(&model_path, &audio.samples, &output_path)
            .expect("Rust transcription should run");
        println!("{summary:?}");
        assert!(summary.frames > 0);
        assert!(summary.notes > 0);
        assert!(output_path.is_file());
    }
}
