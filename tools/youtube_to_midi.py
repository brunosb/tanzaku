#!/usr/bin/env python3
"""Transcribe a local WAV file to MIDI using Spotify Basic Pitch."""

import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print("Uso: python youtube_to_midi.py entrada.wav saida.mid", file=sys.stderr)
        return 2

    input_audio = Path(sys.argv[1])
    output_midi = Path(sys.argv[2])
    if not input_audio.is_file():
        print(f"Áudio não encontrado: {input_audio}", file=sys.stderr)
        return 2

    try:
        from basic_pitch.inference import predict
    except ImportError as error:
        if "basic_pitch" in str(error):
            print("Basic Pitch não está instalado. Execute: uv venv --python 3.11 .venv; uv pip install --python .venv\\Scripts\\python.exe yt-dlp basic-pitch 'setuptools<81'", file=sys.stderr)
        else:
            print(f"Dependência do Basic Pitch ausente: {error}", file=sys.stderr)
        return 3

    try:
        _, midi_data, _ = predict(str(input_audio))
        output_midi.parent.mkdir(parents=True, exist_ok=True)
        midi_data.write(str(output_midi))
    except Exception as error:  # Basic Pitch reports model/audio errors here.
        print(f"Basic Pitch falhou: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
