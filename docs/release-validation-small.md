# Validação do instalador reduzido — Tanzaku 1.0.0

Data: 30/10/2026. Plataforma de build e testes: Windows x64.

## Rebuild na base 1.0.1

- Instalador gerado após integrar a `main` atual: 36.968.654 bytes (35,26 MiB), SHA-256 `45386641B1C9AA7B9A363CDC06512F94BBA8599B2B68802E423DF8EC145C6A7A`.
- `npm test`: aprovado (43 testes de interface; 59 testes Rust aprovados e 1 ignorado por depender de `TANZAKU_TEST_WAV`).
- `npm run test:installer`: aprovado no instalador 1.0.1; incluiu auditoria das dependências, smoke no WebView2/ONNX e reinstalação preservando a biblioteca. O teste do instalador não executou conversão YouTube ao vivo.

## Tamanho

- Instalador anterior: 308.456.421 bytes (294,17 MiB).
- Instalador reduzido: 36.968.909 bytes (35,26 MiB), redução de aproximadamente 88%.
- Aplicativo instalado no smoke: 70.466.166 bytes (67,20 MiB), incluindo licenças e desinstalador.
- FFmpeg de áudio: 5.553.152 bytes; QuickJS-NG: 2.149.746 bytes; yt-dlp standalone: 23.575.744 bytes.
- SHA-256 do instalador: `0273E32A4EC4935295567E5ADFA93116C6320A6E780CBB3C65C2F40C46F8592E`.

## Validações realizadas

- `npm test`: checagens, 43 testes de interface e suíte Rust aprovados. Após os últimos ajustes de código, os testes Rust foram executados novamente: 59 passaram e 1 ficou marcado como ignorado; os quatro testes específicos do atualizador foram repetidos e passaram.
- `npm run check`, `npm run test:runtime`, checagem do template NSIS e `git diff --check`: aprovados.
- FFmpeg de áudio compilado duas vezes no mesmo ambiente WSL/Ubuntu com GCC MinGW 13.2 e NASM 2.16: SHA-256 idêntico `9ea57cc4d5ed922c5b2f7b5b4afadb39c7e42bdade11146cc713e51599a9bff6`. Isso demonstra reprodução no ambiente utilizado; não comprova identidade com outras versões da cadeia de ferramentas.
- Referências Opus/WebM, AAC/M4A, Vorbis/Ogg e MP3 foram convertidas para WAV mono 22.050 Hz e transcritas em MIDI com notas. O binário final gerou WAVs idênticos aos usados na transcrição.
- Assinatura oficial do manifesto do yt-dlp 2026.10.26 validada contra a chave fixada; alterações no manifesto e no executável foram rejeitadas. A substituição do apontador da versão e a preservação após falha foram verificadas localmente.
- Instalação NSIS em caminho com espaços e acento, auditoria dos executáveis e DLLs instalados e smoke em WebView2 real: aprovados. O PATH do aplicativo foi limitado aos diretórios do Windows.
- Conversão real de `https://www.youtube.com/watch?v=9RhCwutqxiA` com os componentes instalados: áudio obtido com yt-dlp e QuickJS, convertido com FFmpeg e transcrito pelo ONNX; o MIDI foi adicionado à biblioteca com quatro eventos.
- Reinstalação sobre o pacote reduzido e uma biblioteca isolada existente: hash da biblioteca preservado, arquivo que representava o Deno antigo removido e auditoria do pacote repetida com sucesso. O teste simula a presença do Deno antigo; não instalou o instalador anterior completo.
- Testes automatizados de janela receptora e do worker para reprodução em segundo plano passaram. O smoke não envia notas ao jogo.

Detalhes do smoke: `src-tauri/target/smoke/result.json`. Auditoria PE instalada: `src-tauri/target/runtime-audit-small.json`.

## Pendências

- Não houve homologação em VM Windows limpa, nem instalação do WebView2 em uma máquina sem o runtime. O bootstrapper embutido necessita de internet quando o runtime estiver ausente.
- Não havia uma versão estável do yt-dlp mais recente que a incluída para exercitar o download e a ativação automáticos de uma atualização real. Os testes cobriram a verificação criptográfica, integridade e substituição do apontador com arquivos de release oficiais.
- Não houve teste manual no jogo real nesta sessão. Os testes automatizados não substituem essa homologação.
- A reinstalação testada usa o instalador reduzido sobre si mesmo; uma atualização a partir do instalador anterior completo permanece pendente.
