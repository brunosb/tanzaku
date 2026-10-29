# Tanzaku

Aplicativo Windows x64 para criar, organizar e tocar MIDIs no modo Música Livre de Where Winds Meet. O backend é Rust/Tauri; a interface usa React, TypeScript e shadcn/ui, com Vite e Tailwind CSS. Node é utilizado somente no desenvolvimento e no build.

## Desenvolvimento

Requisitos: Windows x64, Git LFS, Node.js 22.12+, npm, Rust via rustup e as ferramentas C++ do Visual Studio exigidas pelo Tauri. A versão Rust está fixada em `rust-toolchain.toml`.

```powershell
git lfs install
git lfs pull
npm ci
npm run tauri:run
```

Se o jogo estiver executando como administrador, utilize também um terminal de administrador para iniciar o Tanzaku e enviar as teclas.

O Git LFS deve recuperar `src-tauri/bin/ffmpeg.exe` como um executável completo. O build rejeita ponteiros LFS no lugar desse binário.

## Reprodução

1. Importe um MIDI ou converta uma URL individual do YouTube.
2. Selecione a música ou inicie uma playlist em ordem/aleatória.
3. Aperte Reproduzir e foque o jogo durante os cinco segundos da contagem.
4. Ao perder o foco, a reprodução pausa e libera as teclas. Retome explicitamente pelo aplicativo.
5. Home pausa; End para e cancela transições pendentes, preservando a fila.

A velocidade altera ataques e durações. Em 2x, uma nota de um segundo dura meio segundo real. Buscar libera as teclas; se a música estava tocando, a retomada utiliza a contagem inicial. A continuação automática da biblioteca e das playlists preserva a janela do jogo e dispensa outra contagem.

Anterior e Próxima percorrem a fila atual. Ao trocar manualmente uma música que estava tocando ou pausou por perda de foco, há uma nova contagem de cinco segundos. Se já estava pausada manualmente ou parada, a próxima fica carregada até Reproduzir. O modo Aleatório percorre todas as faixas sem repetir na rodada e preserva o histórico de Anterior/Próxima; desativá-lo restaura a ordem original a partir da faixa atual. Repetir fila reinicia a lista ao terminar.

O tocador mostra a origem, a posição na fila e a próxima música. A barra de posição traz uma forma de onda construída com a atividade das notas MIDI: a parte percorrida recebe um degradê dourado. Clique, arraste ou use o teclado para buscar uma posição.

O mapa mantém as alturas 48–83 e utiliza teclas naturais, SHIFT e CTRL. O planner agrupa ataques em até 20 ms, seleciona até seis notas por grupo e distribui acordes em passos de 5 ms no tempo musical. Notas fora da faixa e notas removidas pela seleção são contabilizadas no plano.

## Biblioteca e playlists

O menu lateral separa Tocador, Biblioteca e Playlists. Clicar no nome de uma música carrega o plano e abre o piano roll; Reproduzir inicia a contagem. A barra inferior permanece disponível em todas as páginas.

Na biblioteca, a fila inclui todas as páginas do resultado filtrado e ordenado no momento da abertura. Na playlist, usa a ordem original e começa na faixa escolhida. Aberturas pelos avisos de importação/conversão usam toda a biblioteca em ordem A–Z. A fila e o modo aleatório duram apenas durante a sessão.

A biblioteca permite buscar sem distinguir acentos ou maiúsculas, filtrar origem e participação em playlists e ordenar por nome ou inclusão. Ctrl+F foca a busca da página. A seleção por checkbox é independente do carregamento; o checkbox do cabeçalho seleciona a página atual, com 50 músicas, e a seleção permanece entre páginas.

Uma playlist possui página própria para adicionar várias músicas, remover referências e reorganizar por Mover acima, Mover abaixo ou Mover para posição. A reordenação exige a ordem original e busca vazia. Alterações são salvas imediatamente e valem para a próxima execução; a fila em andamento permanece intacta. Remover da playlist preserva o MIDI; excluir da biblioteca remove o arquivo e seus vínculos, após confirmação.

Busca, seleção e rolagem são preservadas durante a sessão. Nenhuma duração ou data ausente é inventada. A interface, os ícones e os estilos são empacotados localmente.

## Conversão do YouTube

O instalador inclui yt-dlp, FFmpeg, Basic Pitch ONNX e ONNX Runtime. O aplicativo não utiliza Python nem procura essas dependências globais para funcionar. A aquisição exige conexão com o YouTube.

Uma conversão pode executar por vez. Cancelar interrompe os processos externos e verifica cancelamento entre janelas de inferência. Cada conversão usa uma pasta temporária própria e não importa MIDI sem notas.

Para diagnóstico em desenvolvimento, `TANZAKU_FFMPEG`, `TANZAKU_YTDLP` e `TANZAKU_BASIC_PITCH_MODEL` permitem indicar recursos alternativos. FFmpeg x64 do PATH é um fallback de desenvolvimento.

## Dados

Os dados ficam em `%APPDATA%/Tanzaku`, ou na pasta escolhida na interface. `TANZAKU_DATA_DIR` permite isolar os dados em desenvolvimento. A biblioteca existente é compatível; renomear uma música preserva seu identificador e os vínculos das playlists.

Erros em JSON são apresentados sem substituir o arquivo por uma lista vazia. Gravações usam arquivo temporário e substituição atômica. A troca de pasta descarrega a reprodução e cancela a conversão ativa.

## Comandos

| Comando | Finalidade |
| --- | --- |
| `npm start` / `npm run tauri:run` | Compilar a interface e executar o Tauri |
| `npm run build` | Compilar e preparar o renderer |
| `npm run tauri:check` | Verificar o backend Rust |
| `npm test` | Biome, TypeScript, Vitest e testes Rust |
| `npm run typecheck` | Verificar os tipos sem gerar arquivos |
| `npm run test:renderer` | Testar contratos e estado visual |
| `npm run test:rust` | Testar planner, teclado, transporte, armazenamento e transcrição |
| `npm run tauri:build` / `npm run dist` | Gerar o instalador NSIS |

O instalador é produzido em `src-tauri/target/release/bundle/nsis`. O Windows precisa de WebView2; o instalador Tauri utiliza seu mecanismo padrão de instalação do runtime quando necessário.

## Estrutura

- `src/app/`: composição, layout, navegação e coordenação de diálogos.
- `src/features/`: catálogo, reprodução e configurações, com seus próprios modelos e componentes.
- `src/shared/`: contrato IPC, bridge Tauri, componentes shadcn e estilos.
- `src-tauri/src/`: comandos e módulos Rust de música, biblioteca, reprodução, transcrição, YouTube e plataforma.
- `test/renderer/`, `test/support/` e `test/fixtures/`: regressões, auxiliares e referência Basic Pitch.
- `tools/`: ferramentas de build, smoke, verificação de arquitetura e geração de fixtures.
- `specs/`: arquitetura e critérios de validação.
- `dist/`: saída da interface gerada pelo Vite, ignorada pelo Git.

A verificação desktop opcional usa Node 22+ e uma pasta temporária isolada, sem enviar teclas:

```powershell
npm run test:desktop
# Opcional: usar um MIDI local como entrada do piano roll
npm run build:ui
node tools/smoke/smoke-tauri.cjs "D:\Filmes e Series\partituras\midi\DBZ Makafushigi.mid"
```

As fixtures de referência não exigem Python para executar os testes. Sua regeneração é uma tarefa de desenvolvimento separada, com Basic Pitch 0.4.0, usando `tools/fixtures/generate-reference-fixtures.py`.

A validação com jogo real e as medições de latência/FPS são distintas dos testes automatizados; consulte `specs/10-tauri-validation.md` e `specs/11-navigation-and-library.md`.

A organização por módulos, as regras de dependência e o roteiro para novas funcionalidades estão em [specs/12-project-organization.md](specs/12-project-organization.md). `npm run check:architecture` verifica imports, ciclos e acesso ao Tauri.
