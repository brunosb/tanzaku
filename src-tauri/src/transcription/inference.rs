use ort::{session::Session, value::ValueType};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::{audio, environment::environment_for_model};

const MODEL_RESOURCE_PATH: &str = "models/nmp.onnx";
pub(super) const RUNTIME_RESOURCE_PATH: &str = "runtime/onnxruntime.dll";

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptionProgress {
    Inference { done: usize, total: usize },
    Decoding,
    WritingMidi,
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

pub fn transcribe_wav_cancellable(
    app: &tauri::AppHandle,
    wav: &Path,
    midi: &Path,
    progress: impl FnMut(TranscriptionProgress) -> Result<(), String>,
) -> Result<MidiTranscriptionSummary, String> {
    let model = locate_model(app)?;
    let audio = audio::read_wav(wav)?;
    transcribe_with_progress(&model, &audio.samples, midi, progress)
}
fn transcribe_wav(
    model_path: &Path,
    samples: &[f32],
    midi_path: &Path,
) -> Result<MidiTranscriptionSummary, String> {
    transcribe_with_progress(model_path, samples, midi_path, |_| Ok(()))
}
fn transcribe_with_progress(
    model_path: &Path,
    samples: &[f32],
    midi_path: &Path,
    mut progress: impl FnMut(TranscriptionProgress) -> Result<(), String>,
) -> Result<MidiTranscriptionSummary, String> {
    use ndarray::Array3;
    use ort::value::TensorRef;

    const WINDOW: usize = 43_844;
    const OVERLAP_SAMPLES: usize = 30 * 256;
    const HOP: usize = WINDOW - OVERLAP_SAMPLES;
    const OUTPUT_FRAMES: usize = 172;
    const OUTPUT_COLS: usize = 88;

    let model_started = std::time::Instant::now();
    let environment = environment_for_model(model_path)?;
    let mut session = Session::builder(&environment)
        .map_err(|error| format!("Falha ao criar sessão ONNX: {error}"))?
        .commit_from_file(model_path)
        .map_err(|error| format!("Falha ao abrir o modelo ONNX: {error}"))?;

    eprintln!(
        "Sessão ONNX: {:.2} ms",
        model_started.elapsed().as_secs_f64() * 1000.0
    );
    let inference_started = std::time::Instant::now();
    let mut padded = vec![0.0_f32; OVERLAP_SAMPLES / 2];
    padded.extend_from_slice(samples);
    let mut note_windows = Vec::new();
    let mut onset_windows = Vec::new();
    let mut contour_windows = Vec::new();

    let total = padded.len().div_ceil(HOP);
    for (window_index, start) in (0..padded.len()).step_by(HOP).enumerate() {
        progress(TranscriptionProgress::Inference {
            done: window_index,
            total,
        })?;
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

    progress(TranscriptionProgress::Inference { done: total, total })?;
    progress(TranscriptionProgress::Decoding)?;
    let note = unwrap_windows(&note_windows, OUTPUT_FRAMES, OUTPUT_COLS, samples.len());
    let onset = unwrap_windows(&onset_windows, OUTPUT_FRAMES, OUTPUT_COLS, samples.len());
    let contour = unwrap_windows(&contour_windows, OUTPUT_FRAMES, 264, samples.len());
    let frames = note.len() / OUTPUT_COLS;
    eprintln!(
        "Inferência e janelas: {:.2} ms",
        inference_started.elapsed().as_secs_f64() * 1000.0
    );
    let decode_started = std::time::Instant::now();
    let mut notes = crate::transcription::decoder::decode_notes(&note, &onset, frames);
    crate::transcription::decoder::add_pitch_bends(&mut notes, &contour, frames);
    eprintln!(
        "Decoder: {:.2} ms, {} notas",
        decode_started.elapsed().as_secs_f64() * 1000.0,
        notes.len()
    );
    let write_started = std::time::Instant::now();
    progress(TranscriptionProgress::WritingMidi)?;
    crate::transcription::decoder::write_midi(midi_path, &notes)?;
    eprintln!(
        "Gravação MIDI: {:.2} ms",
        write_started.elapsed().as_secs_f64() * 1000.0
    );
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
    let target_frames = (original_samples as u128 * 86 / 22_050) as usize;
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
#[path = "inference_tests.rs"]
mod tests;
