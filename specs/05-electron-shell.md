# 05 — Shell Electron

Usar Electron sem React ou Vite. Ativar `contextIsolation`, desativar `nodeIntegration`, expor somente API tipada pelo preload e validar argumentos IPC.

Canais: `library:list`, `library:open`, `library:rename`, `library:delete`, `library:import`, `playback:load`, `playback:play`, `playback:pause`, `playback:stop`, `playback:seek`, `playback:set-speed`, `settings:get`, `settings:update`, `overlay:show`, `overlay:hide`, `overlay:set-bounds` e `storage:choose-directory`.

A janela de controle terá biblioteca, transporte, barra de progresso, velocidade, configurações, caminho de dados e controle do overlay.
