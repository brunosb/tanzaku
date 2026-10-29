# Tanzaku

<img src="src/shared/assets/branding/tanzaku-512.png" alt="Símbolo do Tanzaku" width="96" align="right" />

Seu espaço musical em **Where Winds Meet**. Importe MIDIs, organize sua biblioteca e toque no modo Música Livre com um piano roll que acompanha cada nota.

[Baixar para Windows](https://github.com/brunosb/tanzaku/releases/latest) · [Reportar um problema](https://github.com/brunosb/tanzaku/issues/new/choose) · [Contribuir](CONTRIBUTING.md)

**Para tocar no jogo, execute o Tanzaku como administrador.** Abra o jogo no modo Música Livre e mantenha sua janela em foco durante a reprodução.

![Tocador com piano roll completo, fila e forma de onda MIDI](docs/images/player.png)

*Os três grupos de teclas ficam visíveis na janela inicial. As capturas usam dados demonstrativos.*

## Funcionalidades

- Importação de MIDI e conversão de uma URL individual do YouTube.
- Busca sem distinção de acentos ou maiúsculas, filtros de origem e participação em playlists.
- Playlists com adição em lote e edição da ordem das músicas.
- Paginação de 20 itens, com seleção preservada entre páginas.
- Reprodução sequencial ou aleatória, velocidade ajustável e busca pela forma de onda.
- Avanço automático opcional, com escolha salva por biblioteca.

![Biblioteca com busca, filtros, seleção e paginação](docs/images/library.png)

*Busca e organização da coleção, independentes da reprodução.*

![Playlist Viagem entre acordes com músicas e controles de reprodução](docs/images/playlist.png)

*Cada playlist tem busca, paginação e ordem persistida.*

## Instalar e tocar

1. Baixe `Tanzaku_<versão>_x64-setup.exe` na [última release](https://github.com/brunosb/tanzaku/releases/latest).
2. Execute o instalador no Windows 10/11 x64. Ele providencia WebView2 quando necessário.
3. Inicie o Tanzaku **como administrador** e importe um MIDI pela biblioteca.
4. Abra a música e clique em Reproduzir. Durante a contagem de cinco segundos, volte ao jogo.

O instalador inclui FFmpeg, yt-dlp, Basic Pitch ONNX e ONNX Runtime. Para usar o app, não é necessário instalar Node.js, Rust ou Python. A conversão do YouTube requer internet.

Para conferir o download, compare o resultado abaixo com `SHA256SUMS.txt` da release:

```powershell
Get-FileHash .\Tanzaku_1.0.0_x64-setup.exe -Algorithm SHA256
```

| Controle | Comportamento |
| --- | --- |
| Reproduzir / Pausar | Inicia com contagem de cinco segundos ou pausa a faixa |
| Home / End | Pausa / para e cancela transições pendentes |
| Anterior / Próxima | Navega pela fila, mesmo com avanço automático desligado |
| Avanço automático | Desligado inicialmente; quando ligado, continua pela fila |
| Repetir | Repete a faixa atual com avanço desligado, ou a fila com avanço ligado |
| Aleatório | Percorre as faixas sem repetir na rodada e preserva o histórico |
| Forma de onda | Permite buscar por clique, arraste ou teclado |

Ao perder o foco do jogo, a reprodução pausa e libera as teclas. Retome explicitamente pelo aplicativo. Trocas manuais durante a reprodução usam uma nova contagem; a continuação automática preserva a janela do jogo e dispensa outra contagem.

A fila da biblioteca usa todo o resultado filtrado e ordenado, incluindo outras páginas. Na playlist, usa a ordem salva completa. Edições posteriores valem para a próxima abertura. A fila e o modo aleatório duram a sessão.

O mapa musical trabalha com as alturas MIDI 48–83, usando teclas naturais, SHIFT e CTRL. Notas fora da faixa e limitações de acordes são contabilizadas no plano. A transcrição automática pode precisar de revisão musical.

## Desenvolver

Interface em React, TypeScript, Vite, Tailwind CSS e shadcn/ui; backend em Rust/Tauri, responsável pelo relógio musical e envio de teclas.

Requisitos: Windows x64, Git LFS, Node.js 22.12+, npm, Rust via rustup, ferramentas C++ do Visual Studio e WebView2. O Rust é fixado em `rust-toolchain.toml`.

```powershell
git clone https://github.com/brunosb/tanzaku.git
cd tanzaku
git lfs install
git lfs pull
npm ci
npm run tauri:run
```

**Para testar a reprodução no jogo em desenvolvimento, execute o terminal como administrador.** O FFmpeg deve ser recuperado como binário completo pelo Git LFS; o build rejeita ponteiros LFS.

| Comando | Finalidade |
| --- | --- |
| `npm start` | Compilar a interface e executar o aplicativo |
| `npm test` | Estilo, arquitetura, versões, TypeScript, interface e Rust |
| `npm run test:desktop` | Smoke no WebView2 real, IPC e ONNX, sem enviar teclas |
| `npm run tauri:build` | Gerar NSIS com recursos e avisos de licença |
| `npm run test:installer` | Instalar em pasta de teste e validar o app empacotado |
| `npm run check:version` | Conferir versões dos manifestos e lockfiles |

O instalador fica em `src-tauri/target/release/bundle/nsis`. Testes desktop usam dados temporários isolados. Medições de apresentação e testes com o jogo são validações distintas.

| Diretório | Responsabilidade |
| --- | --- |
| `src/app` | Composição, navegação e layout |
| `src/features` | Catálogo, reprodução e configurações |
| `src/shared` | Contratos IPC, componentes e estilos |
| `src-tauri/src` | Biblioteca, MIDI, transporte e transcrição |
| `test` / `tools` | Regressões, fixtures, build e smoke |
| `specs` | Arquitetura e critérios de aceitação |

Em instalações novas, os dados ficam em `%LOCALAPPDATA%\Tanzaku`, junto à instalação por usuário, ou na pasta escolhida em Armazenamento. Escolhas e dados de instalações anteriores continuam compatíveis. `TANZAKU_DATA_DIR` isola os dados de desenvolvimento. Excluir da biblioteca remove o MIDI e seus vínculos após confirmação; remover de uma playlist preserva o arquivo.

Uma conversão do YouTube executa por vez. Para diagnóstico, `TANZAKU_FFMPEG`, `TANZAKU_YTDLP` e `TANZAKU_BASIC_PITCH_MODEL` aceitam caminhos alternativos. As fixtures automatizadas não exigem Python; sua regeneração é uma tarefa separada.

## Contribuir e publicar

Abra uma issue ou envie uma PR a partir de um fork. A `main` exige PR e CI aprovado; o proprietário faz os merges. Use Conventional Commits: `fix:` para correções, `feat:` para funcionalidades e `!` ou `BREAKING CHANGE` para incompatibilidades.

O Release Please prepara uma PR de versão com changelog e manifestos sincronizados. Após seu merge, o CI gera e testa o instalador e publica a release com checksum. Consulte [CONTRIBUTING.md](CONTRIBUTING.md), o [guia de releases](docs/releases.md) e as [regras de arquitetura](specs/12-project-organization.md).

## Licença

O código do Tanzaku está sob [ISC](LICENSE). Componentes distribuídos mantêm suas próprias licenças, incluindo FFmpeg e yt-dlp sob GPLv3+. Textos, atribuições e referências de código fonte acompanham o instalador em `licenses`; veja os [avisos de terceiros](src-tauri/licenses/README.txt).

Tanzaku é um projeto da comunidade, sem vínculo oficial com Where Winds Meet.
