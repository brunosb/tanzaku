# 08 — Empacotamento

Usar electron-builder para Windows. Comandos: `npm run build`, `npm run build:electron` e `npm run dist`. O instalador inclui somente runtime, código compilado e dependências de produção; não inclui `.venv`, MIDI de desenvolvimento ou dependências opcionais de transcrição.

Criar dados no primeiro uso, permitir escolher a pasta da biblioteca e manter CLI para diagnóstico. A interface Electron e o modo terminal são entradas distintas.
