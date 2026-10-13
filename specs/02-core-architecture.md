# 02 — Arquitetura do núcleo

Separar o projeto em:

```text
src/core/{types,planner,playback-engine,keyboard-state,library,storage,acquisition}.ts
src/platform/windows-input.ts
src/electron/{main,preload}.ts
src/renderer/{app,piano-roll,transport,library-view,settings-view}.ts
src/cli/main.ts
```

`core` não depende de Electron, DOM ou readline. `platform` encapsula SendInput, foco e janela do jogo. `electron` cria janelas e IPC. `renderer` contém somente a interface. `cli` mantém compatibilidade com o terminal.

O planner lê MIDI, transpõe, mapeia as 36 teclas, limita polifonia, agrupa acordes, preserva duração e gera eventos temporais. A geração continua em uma faixa principal, sem Demucs, stems ou tabs automáticas.
