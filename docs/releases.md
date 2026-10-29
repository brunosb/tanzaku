# Versões e releases

O Tanzaku usa SemVer e Conventional Commits, começando em `1.0.0`: `fix` gera patch; `feat`, minor; incompatibilidades, major. A publicação é Windows x64 com instalador NSIS.

## Fluxo normal

1. Uma PR passa no job `validate` e é mesclada pelo proprietário.
2. O workflow da `main` valida o código e executa Release Please, que cria ou atualiza a PR de versão.
3. A PR atualiza changelog, manifesto de release, npm e lockfile, Tauri, Cargo e a entrada do app no lockfile Rust. O CI confere a consistência.
4. O proprietário mescla a PR de versão após o CI. Releases futuras não têm auto merge.
5. Release Please cria a tag `vX.Y.Z` e um rascunho. O job `publish` compila o commit da tag, instala e testa o app, anexa o `.exe` e `SHA256SUMS.txt` e publica o rascunho.

A configuração usa versão inicial `1.0.0`, manifesto inicialmente vazio e o commit anterior a essa entrega como limite do primeiro changelog. O identificador Tauri foi preservado para compatibilidade com instalações existentes.

## GitHub

PRs usam token de leitura, sem segredos de publicação. Jobs de release executam na `main` com permissões de escrita limitadas ao necessário. Habilite a opção que permite ao GitHub Actions criar PRs em Settings → Actions → General.

PRs do bot recebem uma execução explícita de `ci.yml` por `workflow_dispatch`, produzindo o check obrigatório sem PAT. A publicação usa as saídas do Release Please no mesmo workflow, sem depender de um novo evento de release do bot.

A `main` exige PR, check `validate`, branch atualizada e conversas resolvidas. Force push e exclusão ficam bloqueados, sem bypass dos checks e sem aprovação obrigatória de outro revisor. Contribuidores externos enviam PRs por forks.

## Recuperar uma publicação

Se build, instalação ou smoke falhar, a release fica em rascunho. Após resolver a causa, repita usando uma tag existente:

```powershell
gh workflow run ci.yml --ref main -f release_tag=v1.0.0
```

O workflow valida a `main`; o job de publicação faz checkout da tag, confere a versão e repete build e smoke. Assets do rascunho podem ser substituídos; releases publicadas são preservadas. Corrija o aplicativo com uma nova versão, sem alterar uma tag publicada.

## Validação

`npm test` cobre estilo, arquitetura, versão, tipos e regressões. O instalador é testado dentro de `src-tauri/target/installer-smoke`, usando biblioteca temporária e recursos empacotados, sem ferramentas globais no PATH.

O build coleta licenças dos pacotes npm de produção e crates Rust, além dos avisos dos binários e modelo. Os textos acompanham a instalação em `licenses`. Atualizações de binários devem incluir os avisos correspondentes.

Diagnósticos do WebView2 ficam nos artifacts. FPS depende do ambiente gráfico; o envio de teclas e a validação com o jogo são sempre manuais.
