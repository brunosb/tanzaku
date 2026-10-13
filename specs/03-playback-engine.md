# 03 — Motor de reprodução

O motor independente expõe `load`, `play`, `pause`, `stop`, `seek`, `setSpeed`, `getState`, `onStateChange` e `onEvent`.

O estado contém `status`, `position`, `duration`, `speed` e `currentEventIndex`. Status possíveis: `idle`, `countdown`, `playing`, `paused`, `stopped` e `ended`.

Usar `performance.now()` como relógio monotônico e tempos MIDI absolutos. Pause, seek, stop e fim liberam teclado e modificadores. Operações são idempotentes e timers antigos nunca afetam uma reprodução nova. A interface somente chama o motor e não envia teclas diretamente.
