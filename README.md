# Tanzaku

Player e workspace MIDI para o modo Música Livre de [Where Winds Meet](https://www.wherewindsmeetgame.com/). O Tanzaku converte músicas em eventos compatíveis com as 36 teclas do jogo e permite visualizar, organizar e reproduzir suas músicas por uma interface desktop ou pelo terminal.

## Recursos

- Reprodução de arquivos MIDI no teclado do Windows.
- Piano roll sincronizado com a reprodução.
- Overlay transparente e não interativo para acompanhar as notas durante o jogo.
- Biblioteca local de músicas e playlists.
- Importação de arquivos `.mid` e `.midi`.
- Importação opcional de músicas do YouTube, convertendo áudio para MIDI.
- Interface desktop em Electron e modo CLI para diagnóstico.

## Requisitos

- Windows x64.
- Node.js 18 ou superior.
- npm.
- O jogo deve estar instalado e em execução para reproduzir notas nele.

Para importar músicas do YouTube, também são necessários:

- Python 3.11.
- [`uv`](https://docs.astral.sh/uv/).
- FFmpeg disponível no `PATH`.
- `yt-dlp` e `basic-pitch`, instalados pelo script de configuração.

## Instalação para desenvolvimento

Clone o repositório e instale as dependências:

```powershell
git clone <url-do-repositorio>
cd tanzaku
npm install
```

Opcionalmente, configure os recursos de transcrição do YouTube:

```powershell
.\tools\setup-transcription.ps1
```

Esse comando cria o ambiente `.venv` e instala `yt-dlp` e `basic-pitch`.

## Desenvolvimento

### Interface Electron

Para iniciar a interface em modo de desenvolvimento, recompilando quando os arquivos mudarem:

```powershell
npm run dev:electron
```

Para executar manualmente após uma compilação:

```powershell
npm run build:electron
npm run start:electron
```

### Modo terminal

O modo CLI continua disponível para diagnóstico e uso sem a interface Electron:

```powershell
npm run cli
```

Também é possível iniciar o CLI com:

```powershell
npm start
```

### Comandos úteis

| Comando | Função |
| --- | --- |
| `npm run check` | Verifica o código com o Biome |
| `npm run lint` | Executa o lint |
| `npm run format` | Formata os arquivos |
| `npm run build` | Compila o projeto TypeScript comum |
| `npm run build:electron` | Compila os módulos usados pelo Electron |
| `npm test` | Executa verificação, compilação e testes |
| `npm run dist` | Gera o instalador de produção para Windows |

## Uso

1. Abra o Tanzaku.
2. Importe um arquivo MIDI pela opção de importação ou adicione uma música pelo YouTube, se as dependências opcionais estiverem configuradas.
3. Selecione a música na biblioteca.
4. Use os controles de reprodução, velocidade, repetição e navegação no piano roll.
5. Com o jogo aberto e focado, inicie a reprodução para enviar as teclas correspondentes.
6. Use o botão de overlay para acompanhar as notas sobre o jogo sem capturar o foco do teclado.

O Tanzaku trabalha com uma faixa principal e mapeia as notas para as 36 teclas do modo Música Livre. A importação de playlists do YouTube não é suportada; informe a URL de um vídeo individual.

## Build e distribuição

Gere o instalador Windows com:

```powershell
npm run dist
```

Esse comando compila a aplicação Electron e executa o `electron-builder`. O instalador NSIS gerado fica na pasta de saída do Electron Builder, normalmente `dist/`.

O pacote de produção inclui o runtime compilado, a interface renderer, o script de transcrição e as dependências necessárias. O ambiente `.venv`, arquivos MIDI de desenvolvimento e dados pessoais da biblioteca não são incluídos no instalador.

## Experimento Tauri/Rust

A branch `experiment/tauri-onnx` contém um shell experimental separado do Electron.
Ela exige Rust via `rustup` e usa a versão fixada em `rust-toolchain.toml`.

```powershell
npm run tauri:check
npm run tauri:run
```

O shell inicial valida a janela Tauri e a comunicação entre a interface e o backend Rust.
O Electron continua sendo a implementação de referência enquanto a migração e a comparação
com ONNX são desenvolvidas.

## Dados da aplicação

Por padrão, a biblioteca e as configurações são armazenadas em:

```text
%APPDATA%\Tanzaku
```

É possível definir outro local usando a variável de ambiente `TANZAKU_DATA_DIR`:

```powershell
$env:TANZAKU_DATA_DIR = 'D:\Dados\Tanzaku'
npm run cli
```

O local da biblioteca também pode ser alterado pela própria interface do aplicativo.

## Testes

Antes de enviar alterações, execute:

```powershell
npm test
```

Os testes verificam o armazenamento, o motor de reprodução, o mapeamento das teclas, o piano roll, a biblioteca, as playlists e a configuração do projeto.

## Estrutura principal

```text
src/core/       Núcleo de MIDI, biblioteca, playlists e reprodução
src/electron/   Processo principal e IPC do Electron
src/renderer/  Interface desktop e estilos
src/platform/  Integração com entrada de teclado do Windows
src/player.ts  CLI e compatibilidade com o player legado
tools/          Scripts auxiliares, incluindo transcrição para MIDI
test/           Testes automatizados
```

## Licença

Este projeto usa a licença ISC.
