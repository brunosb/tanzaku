# Arquitetura

A interface usa exclusivamente `TanzakuApi`, definido em `src/renderer/api.ts`. O bridge registra todos os listeners antes de obter `playback_get_snapshot` e liberar os controles. Argumentos IPC são camelCase.

O worker nativo é a autoridade de transporte, fila, countdown, repetição e teclas. Mantém o relógio monotônico, calcula prazos absolutos e chama o dispositivo Windows no mesmo worker, incluindo key-up. Leitura e planejamento de novas faixas ficam em tarefas separadas, canceladas logicamente por token.

Snapshots completos incluem faixa, plano e estado. Estados periódicos não repetem o plano. Geração identifica o plano e sequência ordena mensagens. Resultados de carregamentos antigos e mensagens visuais antigas são descartados.

Os comandos de aquisição, áudio e ONNX executam em `spawn_blocking`. Mutações da biblioteca são serializadas, e o diretório de destino de uma conversão é conferido antes da importação.

O renderer separa catálogo, navegação e reprodução. `runtime.ts` mantém assinaturas e snapshots estáveis; somente consumidores da reprodução recebem seus estados periódicos. A tabela da biblioteca não depende do avanço do cursor. O piano roll usa um controlador DOM com limpeza de requestAnimationFrame e ResizeObserver ao desmontar. As rotas por hash não executam comandos de transporte.

`playlist_add_tracks` e `playlist_reorder` usam transação e gravação atômica, sem comunicar ações ao worker musical. A fila nativa copia os IDs ao iniciar; edições persistidas valem para a próxima execução.
