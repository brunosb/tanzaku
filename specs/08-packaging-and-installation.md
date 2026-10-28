# Empacotamento Windows

`npm run tauri:build` prepara o renderer por beforeBuildCommand e gera NSIS. O bundle contém modelo ONNX, onnxruntime.dll, yt-dlp.exe e ffmpeg.exe. O aplicativo instalado não depende de Node, Python, Rust ou FFmpeg global.

A ferramenta de build exige Git LFS para FFmpeg e valida o binário Windows x64 antes de copiar recursos. O identificador Tauri existente é mantido para compatibilidade com instalações desta branch; o nome exibido é Tanzaku.

Validar o executável/instalador com pasta de dados isolada e os recursos empacotados. O instalador utiliza a configuração padrão de instalação do WebView2 do Tauri. Não distribuir pastas de build intermediário, biblioteca pessoal ou ambiente Python.
