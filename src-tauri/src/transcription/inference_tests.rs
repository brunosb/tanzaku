use super::inspect_model;
use super::*;
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
    let transcription =
        super::transcribe_wav(&model_path, &samples, &midi_path).expect("transcription should run");
    assert!(transcription.frames > 0);
    assert!(midi_path.is_file());
    let _ = std::fs::remove_file(midi_path);
}

#[test]
#[ignore = "requires TANZAKU_TEST_WAV; generated audio is tested separately"]
fn transcribes_wav_from_environment_when_provided() {
    let wav_path = std::env::var_os("TANZAKU_TEST_WAV").expect("set TANZAKU_TEST_WAV");
    let output_path = std::env::temp_dir().join("tanzaku-basic-pitch-rust.mid");
    let model_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/nmp.onnx");
    let audio = crate::transcription::audio::read_wav(std::path::Path::new(&wav_path))
        .expect("test WAV should be readable");
    let summary = super::transcribe_wav(&model_path, &audio.samples, &output_path)
        .expect("Rust transcription should run");
    println!("{summary:?}");
    assert!(summary.frames > 0);
    assert!(summary.notes > 0);
    assert!(output_path.is_file());
}

#[cfg(test)]
mod pipeline_tests {
    use super::*;
    #[test]
    fn generated_tone_runs_audio_onnx_decoder_and_midi_without_external_files() {
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("tone.wav");
        let midi = dir.path().join("tone.mid");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 22050,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&wav, spec).unwrap();
        for sample in 0..44100 {
            let t = sample as f32 / 22050.0;
            let envelope =
                ((t - 0.1) * 100.0).clamp(0.0, 1.0) * ((1.85 - t) * 100.0).clamp(0.0, 1.0);
            let value = (std::f32::consts::TAU * 440.0 * t).sin() * envelope * 0.7;
            writer.write_sample((value * 32767.0) as i16).unwrap();
        }
        writer.finalize().unwrap();
        let audio = audio::read_wav(&wav).unwrap();
        let model = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(MODEL_RESOURCE_PATH);
        let mut updates = Vec::new();
        let result = transcribe_with_progress(&model, &audio.samples, &midi, |progress| {
            assert!(!midi.exists(), "progress must precede writing the MIDI");
            updates.push(progress);
            Ok(())
        })
        .unwrap();
        let total = match updates[0] {
            TranscriptionProgress::Inference { done: 0, total } => total,
            other => panic!("expected inference first, received {other:?}"),
        };
        let mut expected: Vec<_> = (0..=total)
            .map(|done| TranscriptionProgress::Inference { done, total })
            .collect();
        expected.extend([
            TranscriptionProgress::Decoding,
            TranscriptionProgress::WritingMidi,
        ]);
        assert_eq!(updates, expected);
        assert!(result.notes > 0);
        let bytes = std::fs::read(midi).unwrap();
        let notes = crate::music::midi::read_notes(&bytes).unwrap();
        assert!(notes.iter().any(|n| n.pitch == 69));
        assert!(notes.iter().all(|n| n.duration > 0.0 && n.time >= 0.0));
    }
    #[test]
    fn cancellation_between_windows_does_not_write_midi() {
        let dir = tempfile::tempdir().unwrap();
        let midi = dir.path().join("canceled.mid");
        let model = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(MODEL_RESOURCE_PATH);
        let result = transcribe_with_progress(&model, &vec![0.0; 88200], &midi, |progress| {
            if matches!(progress, TranscriptionProgress::Inference { done: 1, .. }) {
                Err("canceled".to_string())
            } else {
                Ok(())
            }
        });
        assert_eq!(result.unwrap_err(), "canceled");
        assert!(!midi.exists());
    }
    #[test]
    fn cancellation_before_decoder_or_midi_writing_does_not_write_midi() {
        let model = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(MODEL_RESOURCE_PATH);
        for cancel_at in [
            TranscriptionProgress::Decoding,
            TranscriptionProgress::WritingMidi,
        ] {
            let dir = tempfile::tempdir().unwrap();
            let midi = dir.path().join("canceled.mid");
            let mut reached = false;
            let result = transcribe_with_progress(&model, &vec![0.0; 44100], &midi, |progress| {
                if progress == cancel_at {
                    reached = true;
                    Err("canceled".to_string())
                } else {
                    Ok(())
                }
            });
            assert!(reached, "the cancellation point must be reached");
            assert_eq!(result.unwrap_err(), "canceled");
            assert!(!midi.exists());
        }
    }
    #[test]
    fn unwrapping_uses_reference_frame_count() {
        let windows = vec![vec![0.0; 172 * 88]; 2];
        let result = unwrap_windows(&windows, 172, 88, 44100);
        assert_eq!(result.len() / 88, 172);
    }
}
