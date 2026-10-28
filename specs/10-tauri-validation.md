# Registro de validação Tauri — 2026-10-28

## Verificações executadas

- `npm test`: 36 testes Rust e 10 testes do renderer aprovados. Um teste de WAV externo é explicitamente ignorado e exige TANZAKU_TEST_WAV; há teste ONNX completo com WAV musical gerado e detecção de A4.
- Instalador NSIS final gerado com sucesso: `src-tauri/target/release/bundle/nsis/Tanzaku_0.1.0_x64-setup.exe`, cerca de 33,70 MiB. O pacote não foi instalado no sistema durante esta validação.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` e `git diff --check` aprovados.
- WebView2 real: inicialização, inspeção ONNX repetida no mesmo processo, argumentos IPC, playlists, renomeação com ID estável, exclusão da faixa carregada, restauração do snapshot após reload e renderização de 1.871 eventos de DBZ Makafushigi.
- Release com PATH restrito ao Windows: leitura de WAV, ONNX e escrita de MIDI aprovados. Recursos de modelo/runtime/yt-dlp/FFmpeg estão no diretório de recursos do executável.
- Fluxo real de YouTube no release: https://www.youtube.com/watch?v=9RhCwutqxiA (440 Hz sine wave, 600 s). Download, conversão WAV, inferência, geração/importação e carregamento do MIDI concluídos; quatro eventos utilizáveis no plano, duração 596,011 s, seguindo a conversão temporal da referência 0.4.0.
- Nesse áudio, leitura WAV 463 ms, sessão ONNX 80 ms, inferência/janelas 11,77 s, decoder 167 ms e gravação MIDI 19 ms. O decoder não foi reescrito: neste cenário a inferência domina o tempo.
- Apresentação simulada no WebView2 real, 1.871 eventos: cerca de 163 FPS durante 2,5 s, janela visível, sem long tasks reportadas no intervalo após o ajuste de transform/caching do viewport. É uma medição curta da apresentação, sem executar o jogo.

Os outputs locais de smoke ficam em `src-tauri/target/smoke`, incluindo resultado JSON, log e captura do piano roll. Os dados e MIDI usados pelo teste ficam numa pasta temporária isolada; a biblioteca pessoal não é modificada.

A URL testada completou sem runtime JavaScript externo. O yt-dlp 2026.08.19 emitiu aviso sobre ausência de runtime JS na extração; outros formatos/URLs não foram cobertos por esse teste.

## Repetir a verificação desktop

Node 22+ é necessário somente para o cliente CDP opcional:

```powershell
npm run test:desktop -- "caminho\musica.mid"
# Validar o release, com PATH restrito no subprocesso:
node tools/smoke-tauri.cjs "caminho\musica.mid" "src-tauri/target/release/tanzaku-tauri-experiment.exe"
# Incluir uma URL real na verificação isolada:
$env:TANZAKU_SMOKE_YOUTUBE_URL = 'https://www.youtube.com/watch?v=9RhCwutqxiA'
```

Fechar a instância de teste antes de empacotar: o Windows mantém executáveis/DLLs abertos bloqueados. Não executar o smoke do release durante o build NSIS.

## Teste no jogo reservado ao usuário

Por solicitação do usuário, nenhuma reprodução foi executada no Where Winds Meet. O jogo exige terminal de administrador; a validação final de teclas e latência será feita pelo usuário.

- DBZ Makafushigi: registrar os primeiros dez segundos, acordes naturais/SHIFT/CTRL e 0,5x/1x/2x.
- Alterar velocidade durante sustain; perder foco durante nota e silêncio; confirmar liberação e retomada explícita.
- Avançar/repetir playlist sem countdown adicional nem troca do alvo.
- A meta de despacho permanece P95 até 10 ms e máximo até 30 ms; ainda não foi medida no jogo.

`window.tanzaku.playback.onEvent((event,index,timing)=>...)` recebe `lateByMs` e `sendMs` medidos no worker após SendInput. Atraso de entrega ao WebView não altera essa medição. O disparo ocorre no próprio worker de transporte, sem uma fila/timer de notas no renderer. Logs também informam duração do planejamento e resumo P95/máximo ao terminar a reprodução.

A média de FPS do smoke e os testes com dispositivo simulado não comprovam latência final ou ausência de perdas no jogo.
