# Arquitetura

A interface usa exclusivamente `TanzakuApi`, definido em `src/renderer/api.ts`. O bridge registra todos os listeners antes de obter `playback_get_snapshot` e liberar os controles. Argumentos IPC são camelCase.

O worker nativo é a autoridade de transporte, fila, countdown, repetição e teclas. Mantém o relógio monotônico, calcula prazos absolutos e chama o dispositivo Windows no mesmo worker, incluindo key-up. Leitura e planejamento de novas faixas ficam em tarefas separadas, canceladas logicamente por token.

Snapshots completos incluem faixa, plano e estado. Estados periódicos não repetem o plano. Geração identifica o plano e sequência ordena mensagens. Resultados de carregamentos antigos e mensagens visuais antigas são descartados.

Os comandos de aquisição, áudio e ONNX executam em `spawn_blocking`. Mutações da biblioteca são serializadas, e o diretório de destino de uma conversão é conferido antes da importação.
