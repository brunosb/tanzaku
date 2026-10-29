Tanzaku third-party notices
==========================

The Tanzaku application code is distributed under ISC (TANZAKU-LICENSE.txt).
The following separately distributed tools, runtime and model retain their
own licenses. They are shipped unmodified and are not relicensed under ISC.

FFmpeg 9.0.2 essentials_build, Gyan Doshi (Windows x64 static build)
  License: GPL-3.0-or-later; see FFMPEG-GPL-3.0.txt.
  Original binary: https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2
  Build information and included libraries: https://www.gyan.dev/ffmpeg/builds/
  Corresponding FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/946fcce07b
  Source archive: https://github.com/FFmpeg/FFmpeg/archive/946fcce07b.tar.gz
  Configure flags are available by running bin/ffmpeg.exe -buildconf.
  External libraries are identified by that configuration and the build page.

yt-dlp 2026.08.19, PyInstaller executable
  Combined executable: GPL-3.0-or-later; yt-dlp source: Unlicense.
  See YTDLP-LICENSE.txt and YTDLP-THIRD-PARTY.txt for bundled components,
  their licenses, source locations and the upstream source availability offer.
  Source and build instructions: https://github.com/yt-dlp/yt-dlp/tree/2026.08.19
  Source archive: https://github.com/yt-dlp/yt-dlp/archive/refs/tags/2026.08.19.tar.gz

Basic Pitch 0.4.0 ONNX model (nmp.onnx), Copyright 2022 Spotify AB
  License: Apache-2.0; see BASIC-PITCH-LICENSE.txt.
  Source and original model: https://github.com/spotify/basic-pitch/tree/v0.4.0

ONNX Runtime 1.31.0, Copyright Microsoft Corporation
  License: MIT; see ONNXRUNTIME-LICENSE.txt and ONNXRUNTIME-THIRD-PARTY.txt.
  Source: https://github.com/microsoft/onnxruntime/tree/v1.31.0

Frontend and Rust dependency notices are collected from the locked packages
at build time into generated/FRONTEND.txt and generated/RUST.txt. Those files
include original license and copyright notices found in each package.

The installer bundles Microsoft WebView2 using Tauri's standard bootstrapper
when needed. WebView2 is supplied by Microsoft under its own runtime terms.
