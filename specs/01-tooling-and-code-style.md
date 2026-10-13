# 01 — Ferramentas e estilo

Adicionar `@biomejs/biome` e `biome.json` como fonte única de formatação e organização de imports.

## Padrão

- aspas simples;
- quatro espaços de indentação;
- imports organizados automaticamente;
- funções de topo separadas por linhas em branco;
- nenhuma função gigante escrita em uma única linha.

Scripts obrigatórios:

```json
{
    "format": "biome format --write .",
    "format:check": "biome format --check .",
    "lint": "biome lint .",
    "check": "biome check ."
}
```

`npm test` executa Biome check, build TypeScript e testes unitários. Ignorar `node_modules/`, `.venv/`, `dist/`, `midi-cache/**/*.mid` e `midi-cache/.plan-cache/`. Formatação não deve misturar mudanças funcionais sem necessidade.
