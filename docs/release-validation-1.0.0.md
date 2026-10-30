# Relatório de validação do Tanzaku 1.0.0

Data: 30/10/2026
Plataforma de build e smoke: Windows x64
Instalador: `src-tauri/target/release/bundle/nsis/Tanzaku_1.0.0_x64-setup.exe`
Tamanho: 308.456.421 bytes (294,17 MiB)
SHA-256: `7A581B999BD0173787D0CBAA1FAE99FFCC124A0D92566BF09F6DE4FF9295285C`

## Verificações concluídas

- Suíte `npm test`: aprovada; Biome, checagens de arquitetura, template NSIS, versão, auditoria de runtime, commitlint, 43 testes Vitest e 55 testes Rust passaram; 1 teste Rust foi ignorado conforme marcado pela suíte.
- `npm run typecheck` e `npm run check:architecture`: aprovados.
- Preparação dos recursos oficiais e validação dos hashes do manifesto: aprovadas.
- Auditoria do pacote já instalado: aprovada. Os EXEs e DLLs auditados são x64; imports transitivos não Windows foram encontrados no pacote. DLLs do Windows/UCRT foram classificados pelo conjunto explícito do auditor.
- Smoke pelo instalador NSIS em WebView2 real: aprovado. Os dados do teste ficaram isolados em `%TEMP%`.
- Sem instalar Python, uv, Deno ou FFmpeg na máquina, usando `PATH` limitado aos diretórios do Windows, os recursos instalados reportaram yt-dlp `2026.10.26` e Deno `2.9.8`.
- Fluxo real do vídeo de teste `https://www.youtube.com/watch?v=9RhCwutqxiA`: yt-dlp/Deno obtiveram o áudio, FFmpeg gerou WAV, ONNX transcreveu 4 eventos MIDI e o MIDI foi carregado para a biblioteca. O resultado do smoke é `src-tauri/target/smoke/result.json`; o inventário detalhado de imports é `src-tauri/target/runtime-audit.json`.
- Conversão de referência local WAV → ONNX → MIDI: aprovada.
- A instalação utilizada no smoke incluiu o instalador offline de WebView2 configurado pelo bundle NSIS.

## Ainda não homologado

- Não foi usada uma VM Windows recém-criada sem WebView2. O bundle contém o instalador offline, mas a instalação do runtime em uma imagem limpa ainda precisa de homologação.
- A reprodução endereçada via `PostMessage` foi coberta por testes automatizados de janela receptora Windows e pela suíte do worker, mas não foi validada dentro do jogo real. A compatibilidade do jogo, teclas, acordes e modificadores permanece pendente de homologação manual.
- Instalação de atualização com uma biblioteca existente e preservação dos dados foi coberta por persistência automatizada; atualização visual em um perfil de usuário independente não foi executada nesta sessão.

O sucesso do smoke do YouTube confirma o fluxo de download/transcrição com o recurso empacotado nesta máquina conectada; ele não substitui os cenários de VM limpa e jogo real acima.
