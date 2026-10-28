# Arquitetura

A aplicação tem duas raízes de código: a interface React em src e o backend Rust em src-tauri/src. A divisão completa e as regras de crescimento estão em [12-project-organization.md](12-project-organization.md).

A interface usa exclusivamente TanzakuApi, definido em src/shared/api/contracts.ts. O bridge registra todos os listeners antes de obter playback_get_snapshot e liberar os controles. Argumentos IPC são camelCase. Somente o bridge acessa o global nativo Tauri.

A composição em app/runtime.ts cria uma instância de cada estado: catálogo, reprodução e navegação. As funcionalidades recebem contextos tipados próprios e callbacks; não importam app. O catálogo serializa mutações e reconcilia o resultado confirmado pelo backend. Progresso periódico de reprodução não notifica o catálogo. O piano roll usa um controlador DOM com limpeza de requestAnimationFrame e ResizeObserver ao desmontar. Rotas por hash não enviam comandos de transporte.

O worker nativo é a autoridade de transporte, fila, countdown, repetição e teclas. Mantém relógio monotônico e prazos absolutos; ataques e liberações usam o mesmo worker. Leitura e planejamento de faixas ficam em tarefas separadas, canceladas logicamente por token. Adaptação para eventos Tauri, modelo, carregamento e teclado ficam em módulos separados de playback.

Snapshots completos incluem faixa, plano e estado. Estados periódicos não repetem o plano. Geração identifica o plano e sequência ordena mensagens. Resultados de carregamentos antigos e mensagens visuais antigas são descartados.

Comandos IPC ficam em commands; inicialização e encerramento, em app.rs. Aquisição, áudio e ONNX executam em spawn_blocking. A biblioteca conserva um único mutex, validação de JSON e gravação atômica. O destino da conversão é conferido antes da importação. O ambiente ONNX é único; sessões continuam por operação.

playlist_add_tracks e playlist_reorder usam transação e gravação atômica, sem enviar ações ao worker musical. A fila nativa copia os IDs ao iniciar; edições persistidas valem para a próxima execução.
