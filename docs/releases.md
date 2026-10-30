# Versões e releases

O Tanzaku usa SemVer e Conventional Commits, começando em `1.0.0`: `fix` gera patch; `feat`, minor; incompatibilidades, major. A publicação é Windows x64 com instalador NSIS.

## Fluxo normal

1. Uma PR de código passa no job Windows completo `validate` e é mesclada pelo proprietário.
2. O push na `main` executa Release Please sem repetir a validação Windows já exigida na PR.
3. A PR de versão atualiza changelog, manifesto de release, npm e lockfile, Tauri, Cargo e a entrada do app no lockfile Rust. Seu `validate` executa verificações leves de Commitlint, formatação e consistência de versões em Linux.
4. O proprietário aprova a execução do bot se o GitHub solicitar e mescla a PR após o check. Releases futuras não têm auto merge.
5. Release Please cria a tag `vX.Y.Z` e um rascunho. O job `publish` executa `npm test`, compila e testa o instalador da tag, anexa o `.exe` e `SHA256SUMS.txt` e publica o rascunho somente se tudo passar.

Antes do merge da PR de versão, ainda não há tag ou release para download. Essa PR é criada pelo bot do GitHub Actions através do Release Please. Após o merge, aguarde o workflow da `main` terminar; o instalador aparecerá nos assets da release. Builds de PRs de código podem ser baixados no artifact `windows-validation` da execução correspondente do CI, na aba Actions; a PR leve do bot não produz instalador.

A configuração usa versão inicial `1.0.0`, manifesto inicialmente vazio e o commit anterior a essa entrega como limite do primeiro changelog. O identificador Tauri foi preservado para compatibilidade com instalações existentes.

`force-tag-creation: true` cria a tag mesmo enquanto a release está em rascunho. Assim o job de publicação consegue fazer checkout de `vX.Y.Z` para compilar e validar o instalador antes de publicar o download.

O JSON do Tauri usa `expand: always` no Biome, compatível com a serialização feita pelo Release Please. A validação de formatação continua ativa e não bloqueia PRs de versão por diferenças na expansão dos arrays.

O instalador NSIS usa o template do Tauri 2.12.3 com destino inicial absoluto em `%LOCALAPPDATA%\Tanzaku`. Em instalações existentes, o caminho gravado no registro é preservado; versões mais novas atualizam os arquivos no local existente sem executar o desinstalador. CI valida instalação limpa sem `/D` a partir da pasta do projeto e atualiza uma instalação isolada da release `v1.0.0`, verificando também que arquivos preexistentes sobrevivem.

## GitHub

PRs usam token de leitura, sem segredos de publicação. Jobs de release executam na `main` com permissões de escrita limitadas ao necessário. Habilite a opção que permite ao GitHub Actions criar PRs em Settings → Actions → General.

PRs do Release Please usam o evento `pull_request` e o mesmo check obrigatório `validate`, em modo leve. Quando o GitHub exigir aprovação para uma PR criada com `GITHUB_TOKEN`, o proprietário aprova essa execução; não dispare um `workflow_dispatch` paralelo, pois ele não substitui o check da PR. A publicação usa as saídas do Release Please no mesmo workflow, sem depender de um novo evento de release do bot.

A `main` exige PR, check `validate`, branch atualizada e conversas resolvidas. Force push e exclusão ficam bloqueados, sem bypass dos checks e sem aprovação obrigatória de outro revisor. Contribuidores externos enviam PRs por forks.

## Recuperar uma publicação

Se build, instalação, testes ou smoke falharem, a release fica em rascunho. Após resolver a causa, repita usando uma tag existente:

```powershell
gh workflow run ci.yml --ref main -f release_tag=v1.0.0
```

O job de publicação faz checkout da tag, executa a validação completa, confere a versão e repete build e smoke. Assets do rascunho podem ser substituídos; releases publicadas são preservadas. Corrija o aplicativo com uma nova versão, sem alterar uma tag publicada.

## Validação

`npm test` cobre estilo, arquitetura, versão, tipos e regressões. O instalador é testado dentro de `src-tauri/target/installer-smoke`, usando biblioteca temporária e recursos empacotados, sem ferramentas globais no PATH.

O build coleta licenças dos pacotes npm de produção e crates Rust, além dos avisos dos binários e modelo. Os textos acompanham a instalação em `licenses`. Atualizações de binários devem incluir os avisos correspondentes.

Diagnósticos do WebView2 ficam nos artifacts. FPS depende do ambiente gráfico; o envio de teclas e a validação com o jogo são sempre manuais.
