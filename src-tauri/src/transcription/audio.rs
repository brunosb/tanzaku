use std::path::Path;

pub const SAMPLE_RATE: u32 = 22_050;

pub struct MonoAudio {
    pub samples: Vec<f32>,
}

pub fn read_wav(path: &Path) -> Result<MonoAudio, String> {
    let started = std::time::Instant::now();
    let mut reader = hound::WavReader::open(path)
        .map_err(|error| format!("Não foi possível abrir o WAV: {error}"))?;
    let spec = reader.spec();
    if spec.channels == 0 {
        return Err("O WAV não possui canais de áudio.".to_string());
    }
    if spec.sample_rate != SAMPLE_RATE {
        return Err(format!(
            "O WAV precisa estar em {SAMPLE_RATE} Hz; recebido {} Hz.",
            spec.sample_rate
        ));
    }

    let samples = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i32>()
            .map(|sample| {
                sample
                    .map(|value| value as f32 / 2_f32.powi(spec.bits_per_sample as i32 - 1))
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?,
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|sample| sample.map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?,
    };

    let channels = spec.channels as usize;
    let mono = samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect();
    eprintln!(
        "Leitura WAV: {:.2} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
    Ok(MonoAudio { samples: mono })
}
