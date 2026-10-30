# Empacotamento Windows

`npm run tauri:build` prepara os recursos Windows x64 do manifesto com versões e hashes fixados, coleta as licenças, prepara o renderer e gera NSIS. O bundle contém modelo ONNX, onnxruntime.dll, yt-dlp standalone, QuickJS-NG, FFmpeg de áudio, as DLLs locais do Visual C++ e o bootstrapper do WebView2. O aplicativo instalado não depende de Node, Python, Rust ou FFmpeg global. As conversões do YouTube precisam de internet.

A ferramenta de build exige Git LFS para FFmpeg e valida versões, hashes, arquiteturas, conteúdo PE, marcadores do uv e dependências importadas antes de empacotar. O script runtime:prepare prepara os recursos e runtime:prepare -- --verify os valida sem baixá-los. O identificador Tauri existente é mantido para compatibilidade com instalações desta branch; o nome exibido é Tanzaku.

Validar o executável/instalador com pasta de dados isolada e auditar recursivamente as dependências dos arquivos extraídos antes de iniciar o aplicativo. Se WebView2 estiver ausente, o bootstrapper precisa de internet. Não distribuir pastas de build intermediário, biblioteca pessoal, ambientes virtuais ou caches de downloads.

O FFmpeg reduzido é compilado a partir da fonte fixada com `sh tools/release/build-ffmpeg.sh`, usando WSL/Linux, GCC MinGW x64, GCC nativo, make, nasm e curl. O binário resultante é armazenado em Git LFS e tem seu hash fixado no manifesto. QuickJS cria arquivos temporários para os scripts EJS; veja a documentação de segurança do yt-dlp. A atualização automática de yt-dlp verifica a assinatura e o hash oficiais antes de usar um executável na pasta local do usuário; o executável instalado continua disponível como reserva.

A versão inicial pública é 1.0.0 e todos os manifestos/lockfiles são conferidos por `npm run check:version`. O build coleta avisos npm e Rust e empacota `licenses`, incluindo textos de FFmpeg, yt-dlp, ONNX Runtime e Basic Pitch. Release Please mantém a PR de versão; o CI da tag gera e valida o NSIS antes de publicar a release com SHA256SUMS.txt. O fluxo e a recuperação de rascunhos estão em `docs/releases.md`.
