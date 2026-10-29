# Contribuir com o Tanzaku

Use issues para relatar bugs ou propor melhorias. Antes de uma mudança ampla, descreva o comportamento esperado para alinhar o trabalho.

1. Faça um fork e crie uma branch a partir da `main` atualizada.
2. Siga os requisitos e comandos do [README](README.md#desenvolver).
3. Preserve os limites de módulos descritos em [specs/12-project-organization.md](specs/12-project-organization.md).
4. Atualize os testes e as especificações do comportamento alterado.
5. Execute `npm test`; para mudanças visuais ou IPC, execute também `npm run test:desktop`.
6. Envie uma PR com o problema, a solução e a validação. Inclua capturas para mudanças visuais.

Não inclua biblioteca pessoal, MIDIs de terceiros, credenciais ou arquivos de build. Os smokes usam dados temporários e não enviam teclas ao jogo. Testar a reprodução no jogo exige execução como administrador e validação manual.

## Commits e versões

Use `tipo(escopo opcional): descrição`, por exemplo:

```text
feat(playback): add optional auto advance
fix(catalog): reset pagination after filtering
docs: explain administrator requirements
```

Tipos aceitos: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `build`, `perf`, `revert` e `style`. Use `!` ou um rodapé `BREAKING CHANGE:` para incompatibilidades. O título da PR também deve seguir esse formato.

`npm ci` instala os hooks do Husky automaticamente. Continue usando `git commit` ou o IDE normalmente: o Commitlint valida a mensagem antes de criar o commit. O cabeçalho aceita até **1.000 caracteres**; corpo e rodapé podem ter explicações extensas, sem restrição de comprimento das linhas. Português e inglês são aceitos.

Se a mensagem for rejeitada, corrija o tipo ou a descrição e tente novamente. Para validar o histórico da sua branch manualmente:

```powershell
npm run commitlint -- --from origin/main --to HEAD --verbose
```

O CI valida o título e todos os commits da PR usando a mesma configuração. O CI usa `HUSKY=0` para não instalar hooks e executa Commitlint explicitamente. `npm run test:commitlint` verifica os limites de tamanho e mensagens válidas/inválidas.

Enviar um commit novo para a branch de uma PR dispara o Action automaticamente. Para repetir a mesma execução sem mudar código, abra Actions, selecione a execução e use **Re-run failed jobs**. Corrija a causa da falha antes de repetir. `npm run test:rust` prepara a interface antes do Cargo para funcionar também em um checkout limpo.

Não aumente a versão manualmente em uma PR comum. O Release Please prepara a PR de versão com changelog e lockfiles sincronizados; o proprietário revisa e mescla. Consulte [docs/releases.md](docs/releases.md).

A `main` exige PR, validação aprovada, base atualizada e conversas resolvidas. A aprovação de outro revisor não é obrigatória. A comunidade contribui por forks; acesso público não concede permissão de escrita.

## Capturas de apresentação

Depois de compilar a interface, renove as imagens com dados demonstrativos:

```powershell
$env:TANZAKU_CAPTURE_DOCS = '1'
npm run test:desktop
Remove-Item Env:TANZAKU_CAPTURE_DOCS
```

O smoke captura o aplicativo real em `docs/images`. Revise as três imagens antes de comitar.

Ao contribuir, você disponibiliza seu código sob a licença ISC do projeto. Preserve as atribuições de terceiros.
