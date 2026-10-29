# Testes e aceitação

Executar `npm test`, cargo fmt --check, cargo clippy --all-targets -- -D warnings e build NSIS.

Rust cobre mapa, seleção de acordes, duração total, relógio/velocidade, teclado/modificadores, cancelamento de carregamento, playlist, foco e encerramento. O worker é exercitado com dispositivo e publicação injetáveis, sem enviar teclas ao computador nos testes.

A transcrição possui fixtures controladas do Basic Pitch 0.4.0, verificação de ticks MIDI, bends extremos, silêncio, cancelamento e um WAV musical gerado executado pelo ONNX real. O teste opcional de WAV externo é explicitamente ignored; só executar com TANZAKU_TEST_WAV configurada.

JavaScript cobre argumentos IPC, inicialização/listeners, gerações e sequências, fila exclusivamente nativa, cancelamento por jobId, destaques simultâneos e interpolação do cursor.

Vitest e Testing Library cobrem navegação, busca normalizada, paginação, seleção múltipla, edição de playlists, erros e foco de diálogos. O smoke desktop percorre as páginas no WebView2 real com 10 mil músicas em diretório temporário, valida IPC de adição em lote/reordenação e mede dez segundos de apresentação simulada, sem iniciar o teclado nativo.

O smoke de fila também valida ordem da biblioteca, histórico aleatório, correspondência do próximo título, congelamento da ordem da playlist, renomeações e busca real por mouse/teclado. Uma faixa MIDI gerada com variações e silêncios produz 944 eventos; o transporte é simulado em velocidade normal por cinco segundos. O teste exige pelo menos 60 FPS, até uma tarefa longa e nenhuma alteração no SVG da forma de onda durante a apresentação. São capturadas telas em 900×920, 560×780, 900×650 e 400×700. Os resultados ficam em src-tauri/target/smoke/result.json, separados da validação manual no jogo.

A validação manual deve medir DBZ Makafushigi com jogo em foco, incluindo primeiros dez segundos, silêncio, acordes, mudança de velocidade e perda de foco. Meta de despacho: P95 até 10 ms e máximo até 30 ms. Medir FPS e tarefas longas com piano roll visível, além de testar URL individual até importação. Esses resultados devem ser registrados separadamente dos testes automatizados.
