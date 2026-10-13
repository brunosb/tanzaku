# 04 — Armazenamento e biblioteca

O padrão é `app.getPath('userData')` com `midi/`, `plans/`, `library.json` e `settings.json`. Uma pasta escolhida pelo usuário usa a mesma estrutura. O CLI e o Electron usam o mesmo módulo de storage.

Criar diretórios automaticamente, validar nomes, impedir traversal, renomear arquivo e registro juntos, excluir MIDI e registro juntos e manter planos derivados fora do Git. Nunca usar o diretório de instalação como armazenamento permanente.

Na primeira execução, detectar `midi-cache/` legado, oferecer cópia segura para o novo local, preservar a origem e manter títulos e URLs. Não apagar dados antigos automaticamente.
