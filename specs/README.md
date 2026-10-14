# Plano de evolução do Tanzaku

Estas especificações descrevem a evolução do CLI para uma aplicação Windows com Electron mínimo, mantendo o núcleo de reprodução independente da interface.

## Ordem obrigatória

Implementar na ordem `01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09`. Cada etapa deve manter os testes anteriores passando antes de iniciar a próxima.

## Dependências

- 02 depende de 01.
- 03 depende de 02.
- 04 depende de 02.
- 05 depende de 02 e 04.
- 06 depende de 05.
- 07 depende de 03 e 05.
- 08 depende de 05, 06 e 07.
- 09 valida todas as etapas.

## Decisões fixadas

- Electron mínimo, sem React, Vite ou framework visual.
- Piano roll é a visualização inicial; partitura tradicional fica para uma fase posterior.
- O overlay é transparente, click-through e não captura foco.
- O núcleo de reprodução é compartilhado pelo CLI e pelo Electron.
- Dados ficam no AppData por padrão, com pasta personalizada opcional.
- `midi-cache/` do repositório contém somente `.gitkeep`; MIDI, biblioteca e planos são locais.
- A primeira versão gera uma faixa principal e não separa stems, tabs ou instrumentos.
- Python, Basic Pitch, yt-dlp e FFmpeg continuam dependências opcionais externas.

## Checklist

- [ ] Formatação e verificação do Biome configuradas.
- [ ] Núcleo separado da interface.
- [ ] Motor de reprodução independente e testado.
- [ ] Armazenamento AppData/personalizado com migração segura.
- [ ] Janelas de controle e overlay seguras.
- [ ] Piano roll sincronizado e seek funcional.
- [ ] Instalador Windows mínimo.
- [ ] Testes unitários, de interface e de build passando.

Não implementar separação de stems nesta versão.
