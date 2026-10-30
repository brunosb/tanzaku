# Versões e releases

O Tanzaku usa SemVer e Conventional Commits, começando em `1.0.0`: `fix` gera patch; `feat`, minor; incompatibilidades, major. A publicação é Windows x64 com instalador NSIS.

## Fluxo normal

1. Uma PR de código passa no check obrigatório `validate`, que agrega `checks` no Ubuntu (`npm run test:node`) e `rust (windows)` (`npm run test:rust`). PRs comuns não compilam instalador.
2. O push na `main` executa Release Please, sem repetir a suíte já exigida nas PRs de código.
3. A PR de versão atualiza changelog, manifesto de release, npm e lockfile, Tauri, Cargo e a entrada do app no lockfile Rust. A classificação leve só vale para a branch exata do Release Please, aberta pelo bot neste repositório; o workflow confere também a lista permitida de arquivos. Seu job Windows compila e testa o instalador daquela versão uma única vez.
4. O proprietário aprova a execução do bot se o GitHub solicitar e mescla a PR após o check. Releases futuras não têm auto merge.
5. Release Please cria a tag `vX.Y.Z` e um rascunho. O job `publish` encontra a PR de release associada à tag, baixa o instalador já testado e confere a versão, árvore de código, PR de origem, tamanho e SHA-256 antes de anexar o `.exe` e `SHA256SUMS.txt`. Não recompila nem repete a suíte. Se a execução ou o artefato não puderem ser identificados sem ambiguidade, nada é publicado.

Antes do merge da PR de versão, ainda não há tag ou release para download. Essa PR é criada pelo bot do GitHub Actions através do Release Please. O instalador passa por smoke e atualização antes do merge; após o merge, o workflow promove o mesmo binário validado para os assets da release. O artefato temporário é retido por até 90 dias.

A configuração usa versão inicial `1.0.0`, manifesto inicialmente vazio e o commit anterior a essa entrega como limite do primeiro changelog. O identificador Tauri foi preservado para compatibilidade com instalações existentes.

`force-tag-creation: true` cria a tag enquanto a release está em rascunho. O workflow compara a árvore apontada pela tag com a árvore usada para compilar e testar o instalador na PR de versão.

O JSON do Tauri usa `expand: always` no Biome, compatível com a serialização feita pelo Release Please. A validação de formatação continua ativa e não bloqueia PRs de versão por diferenças na expansão dos arrays.

O instalador NSIS usa o template do Tauri 2.12.3 com destino inicial absoluto em `%LOCALAPPDATA%\Tanzaku`. Em instalações existentes, o caminho gravado no registro é preservado; versões mais novas atualizam os arquivos no local existente sem executar o desinstalador. CI valida instalação limpa sem `/D` a partir da pasta do projeto e atualiza uma instalação isolada da release `v1.0.0`, verificando também que arquivos preexistentes sobrevivem.

## GitHub

PRs usam token de leitura, sem segredos de publicação. O job Windows que compila a PR de versão só envia um artifact da Actions e tem permissões de leitura. Depois do merge, o job Linux de publicação usa `actions:read` para baixar o artifact da execução correspondente e `contents:write` para anexar os arquivos da release. Habilite a opção que permite ao GitHub Actions criar PRs em Settings → Actions → General.

PRs do Release Please usam o evento `pull_request` e o mesmo check obrigatório `validate`, incluindo build e smoke do instalador. A triagem confere o autor, repositório e branch exatos, além de limitar os arquivos alterados aos metadados de versão e changelog. Uma alteração fora da lista permitida falha o check. O Commitlint do título e dos commits executa em Bash no job Ubuntu. Quando o GitHub exigir aprovação para uma PR criada com `GITHUB_TOKEN`, o proprietário aprova essa execução; não dispare um `workflow_dispatch` paralelo, pois ele não substitui o check da PR. A publicação usa as saídas do Release Please no push da `main`, sem depender de um evento de tag disparado pelo bot.

A `main` exige PR, check `validate`, branch atualizada e conversas resolvidas. Force push e exclusão ficam bloqueados, sem bypass dos checks e sem aprovação obrigatória de outro revisor. Contribuidores externos enviam PRs por forks.

## Recuperar uma publicação

Se build, instalação, testes ou smoke falharem, a release fica em rascunho. Após resolver a causa, repita usando uma tag existente:

```powershell
gh workflow run ci.yml --ref main -f release_tag=v1.1.0
```

Use esse fluxo apenas se o artifact da PR de release tiver expirado ou estiver inválido. O workflow recompila e valida a tag no Windows, então publica o resultado verificado. Assets do rascunho podem ser substituídos; releases já publicadas são preservadas. Corrija o aplicativo com uma nova versão, sem alterar uma tag publicada.

## Validação

`npm test` executa `npm run test:node` e `npm run test:rust`. `test:node` inclui os testes da política de classificação de PRs e de integridade/proveniência do artefato. O job Windows da PR de release instala em pasta de teste, audita recursos empacotados e verifica instalação limpa e atualização. O job de publicação valida o manifesto e o hash antes de anexar o arquivo; não instala dependências nem recompila o aplicativo.

O build coleta licenças dos pacotes npm de produção e crates Rust, além dos avisos dos binários e modelo. Os textos acompanham a instalação em `licenses`. Atualizações de binários devem incluir os avisos correspondentes.

Diagnósticos do WebView2 ficam nos artifacts. FPS depende do ambiente gráfico; o envio de teclas e a validação com o jogo são sempre manuais.
