# Testes e aceitação

Executar `npm test`, cargo fmt --check, cargo clippy --all-targets -- -D warnings e build NSIS.

Rust cobre mapa, seleção de acordes, duração total, relógio/velocidade, teclado/modificadores, cancelamento de carregamento, playlist, foco e encerramento. O worker é exercitado com dispositivo e publicação injetáveis, sem enviar teclas ao computador nos testes.

A transcrição possui fixtures controladas do Basic Pitch 0.4.0, verificação de ticks MIDI, bends extremos, silêncio, cancelamento e um WAV musical gerado executado pelo ONNX real. O teste opcional de WAV externo é explicitamente ignored; só executar com TANZAKU_TEST_WAV configurada.

JavaScript cobre argumentos IPC, inicialização/listeners, gerações e sequências, fila exclusivamente nativa, cancelamento por jobId, destaques simultâneos e interpolação do cursor.

Regressões cobrem avanço desligado/ligado em biblioteca e playlist, ordens sequencial/aleatória, repetição da faixa/fila e cancelamento de transição pendente. Persistência preserva outros campos e JSON inválido; falhas de gravação não alteram a indicação do botão. O smoke confirma a preferência no disco e sua restauração na troca de armazenamento.

Paginação usa 20 itens, com cenários de 0, 1, 20, 21 e 41 resultados, busca após mudar de página, seleção entre páginas e redução da última página. O smoke exige todas as 21 linhas visíveis em 900×920.

O CI executa testes e build NSIS; `npm run test:installer` instala dentro de target e verifica recursos empacotados no WebView2, com dados isolados e sem ferramentas globais no PATH. Release só é publicada após essa validação e recebe SHA256SUMS.txt. `npm run check:version` exige versões sincronizadas nos manifestos e lockfiles.

No desktop local, os smokes exigem 60 FPS e até uma tarefa longa. Em runners compartilhados de CI, FPS e tarefas longas são diagnósticos, pois não há garantia de taxa de atualização do monitor. Os checks funcionais e a ausência de mutações do gráfico permanecem obrigatórios.

Vitest e Testing Library cobrem navegação, busca normalizada, paginação, seleção múltipla, edição de playlists, erros e foco de diálogos. O smoke desktop percorre as páginas no WebView2 real com 10 mil músicas em diretório temporário, valida IPC de adição em lote/reordenação e mede dez segundos de apresentação simulada, sem iniciar o teclado nativo.

O smoke de fila também valida ordem da biblioteca, histórico aleatório, correspondência do próximo título, congelamento da ordem da playlist, renomeações e busca real por mouse/teclado. Uma faixa MIDI gerada com variações e silêncios produz 944 eventos; o transporte é simulado em velocidade normal por cinco segundos. O teste exige pelo menos 60 FPS, até uma tarefa longa e nenhuma alteração no SVG da forma de onda durante a apresentação. São capturadas telas em 900×920, 560×780, 900×650 e 400×700. Os resultados ficam em src-tauri/target/smoke/result.json, separados da validação manual no jogo.

A validação manual deve medir DBZ Makafushigi com jogo em foco, incluindo primeiros dez segundos, silêncio, acordes, mudança de velocidade e perda de foco. Meta de despacho: P95 até 10 ms e máximo até 30 ms. Medir FPS e tarefas longas com piano roll visível, além de testar URL individual até importação. Esses resultados devem ser registrados separadamente dos testes automatizados.
