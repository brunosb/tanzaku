Tanzaku third-party notices
==========================

The Tanzaku application code is distributed under ISC (TANZAKU-LICENSE.txt).
The following separately distributed tools, runtime and model retain their
own licenses. They are shipped unmodified and are not relicensed under ISC.

FFmpeg 9.0.2, Tanzaku audio-only Windows x64 build
  License: LGPL-2.1-or-later; see FFMPEG-LGPL-2.1.txt.
  Corresponding FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/946fcce07b
  Source archive: https://github.com/FFmpeg/FFmpeg/archive/946fcce07b.tar.gz
  Build script: tools/release/build-ffmpeg.sh in the Tanzaku source.
  Configure flags are available by running bin/ffmpeg.exe -buildconf.

yt-dlp 2026.10.26, official Windows executable with bundled Python and EJS
  Combined executable: GPL-3.0-or-later; yt-dlp source: Unlicense.
  See YTDLP-LICENSE.txt and YTDLP-THIRD-PARTY.txt for bundled components,
  their licenses, source locations and the upstream source availability offer.
  Source and build instructions: https://github.com/yt-dlp/yt-dlp/tree/2026.10.26
  Source archive: https://github.com/yt-dlp/yt-dlp/archive/refs/tags/2026.10.26.tar.gz

Basic Pitch 0.4.0 ONNX model (nmp.onnx), Copyright 2022 Spotify AB
  License: Apache-2.0; see BASIC-PITCH-LICENSE.txt.
  Source and original model: https://github.com/spotify/basic-pitch/tree/v0.4.0

QuickJS-NG 0.16.2 (Windows x64)
  License: MIT; see QUICKJS-NG-LICENSE.txt.
  Release: https://github.com/quickjs-ng/quickjs/releases/tag/v0.16.2

Microsoft Visual C++ runtime 14.39.33321.0 (Windows x64)
  License: Microsoft Visual Studio Redistributable terms.
  Official package: https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx

Microsoft WebView2 Evergreen Runtime (bootstrapper)
  License: Microsoft Edge WebView2 Runtime terms.
  Distributed through Tauri's official embedded bootstrapper configuration.

ONNX Runtime 1.31.0, Copyright Microsoft Corporation
  License: MIT; see ONNXRUNTIME-LICENSE.txt and ONNXRUNTIME-THIRD-PARTY.txt.
  Source: https://github.com/microsoft/onnxruntime/tree/v1.31.0

Frontend and Rust dependency notices are collected from the locked packages
at build time into generated/FRONTEND.txt and generated/RUST.txt. Those files
include original license and copyright notices found in each package.

The bootstrapper downloads WebView2 from Microsoft when needed.
