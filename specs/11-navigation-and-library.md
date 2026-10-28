# Navegação, biblioteca e playlists

## Implementação

A referência funcional anterior é `0895436`. O renderer usa React/TypeScript, Vite, Tailwind CSS 4 e componentes shadcn/ui baseados em Radix, incorporados pelo CLI 4.23.0. Os componentes ficam versionados no projeto, com ajuste local dos tokens de cor, do utilitário `cn` e do tema escuro das notificações. Ícones Lucide, fontes do sistema e todos os estilos são locais. O CSP permite estilos inline utilizados pelas primitivas visuais; scripts continuam restritos ao aplicativo.

As rotas são `#/player`, `#/library`, `#/playlists` e `#/playlists/:id`. O tocador é a página inicial. Navegação, histórico, busca e seleção não enviam comandos de transporte. Abrir uma música carrega o plano e retorna ao piano roll, sem iniciar teclas. A barra inferior permanece disponível em todas as páginas.

O catálogo usa um armazenamento externo com transações de interface serializadas, atualizadas somente pelos resultados confirmados pelo backend. Falhas preservam os dados anteriores e permitem nova leitura. Se uma operação com remoções individuais falhar após algumas confirmações, a interface consulta os dados persistidos antes de apresentar o erro.

Eventos periódicos de reprodução ficam em um armazenamento separado. O piano roll conserva o desenho por DOM, com escala de 120 px/s, cursores por transform, referências de elementos, atualizações por diferença e interpolação limitada a 100 ms. React não reconstrói suas notas a cada posição. Desmontar a página cancela a animação e desconecta o ResizeObserver.

## Organização

- A biblioteca filtra por nome sem acentos/caixa, origem e participação em playlists. Nome e ordem de inclusão são as opções de ordenação; datas e durações ausentes não são inventadas.
- Tabelas têm páginas de 50 músicas; a grade tem páginas de 24 playlists. O checkbox do cabeçalho seleciona a página visível. Seleções, filtros, página e rolagem duram a sessão; trocar de armazenamento limpa esses estados.
- Adição em lote usa um diálogo pesquisável. A playlist admite referências indisponíveis, identificadas visualmente e removidas somente por ação explícita.
- A ordem salva é editada por Mover acima/abaixo ou Mover para posição. Busca vazia e ordem original são obrigatórias. Ordenar a apresentação por nome não salva uma nova ordem.
- Reproduzir sempre usa a playlist completa na ordem persistida, ou em modo aleatório. A fila nativa copia os IDs no início; alterações só entram em vigor na próxima execução.
- Remover referências preserva os MIDIs. Excluir da biblioteca apaga o arquivo e seus vínculos após confirmação. Renomear mantém IDs.
- YouTube mantém uma operação ativa, progresso por jobId e cancelamento. Uma conclusão não substitui a faixa carregada; a notificação oferece Abrir no tocador.

## Contratos e compatibilidade

`TanzakuApi.playlists.addMany(playlistId, trackIds)` chama `playlist_add_tracks`; `reorder(playlistId, trackIds)` chama `playlist_reorder`. Ambos usam camelCase no IPC e retornam a playlist confirmada.

Adição valida todos os IDs antes de gravar e acrescenta apenas os ausentes, na ordem recebida. Reordenação exige uma permutação exata, incluindo referências indisponíveis e sua multiplicidade. Ambos usam o mutex e a gravação atômica existentes e não comunicam ações ao transporte. Nenhuma migração dos JSON existentes é necessária.

`npm run build:ui` verifica tipos e gera diretamente `dist` com caminhos relativos. Os scripts de compilação e cópia antigos foram retirados. Node 22.12+ é ferramenta de desenvolvimento; o aplicativo distribuído continua independente de Node/Python.

## Validação

O smoke usa armazenamento e perfil WebView temporários. Nenhum comando de iniciar reprodução é executado, e nenhuma tecla é enviada ao jogo. O MIDI DBZ é apenas lido como entrada do plano; os dados pessoais não são alterados.

A referência antes da migração mediu 139,39 FPS em 2,5 segundos, com 1.871 eventos e zero tarefas longas. O primeiro smoke completo após a migração mediu 164,15 FPS em dez segundos, também sem tarefas longas. A diferença não deve ser interpretada como ganho garantido, pois a duração das amostras é diferente.

O mesmo smoke percorreu Biblioteca, Playlists e detalhe com 10.001 músicas; a busca por `AGUAS` encontrou `Águas do Céu` em 110 ms, incluindo sincronização de duas animações e consulta CDP. Selecionou 51 músicas entre páginas, adicionou em lote, reordenou pelo menu real e confirmou que faixa, geração e status nativos permaneceram iguais. O ONNX real converteu um WAV gerado até MIDI.

Os 25 testes do renderer passaram, cobrindo os contratos antigos, busca, paginação, seleção, diálogos, cancelamento, seek, exclusão, troca de pasta e falhas. Os 38 testes Rust passaram, incluindo integridade das duas novas operações e uso da ordem editada apenas na próxima execução. O teste externo de WAV continua explicitamente ignorado por exigir TANZAKU_TEST_WAV. TypeScript, Biome, cargo fmt e Clippy com warnings negados também passaram.

O smoke debug final, após corrigir o posicionamento das notificações no layout, mediu 163,25 FPS em dez segundos, zero tarefas longas e busca em 103 ms. Também verificou o layout compacto em 560 × 780 e a barra de transporte dentro da área visível.

O build NSIS concluiu com sucesso: `src-tauri/target/release/bundle/nsis/Tanzaku_0.1.0_x64-setup.exe`, 35.492.119 bytes (33,85 MiB). O executável de release também passou pelo smoke completo com PATH restrito a Windows/System32 e sem overrides de ferramentas/modelo: 147,06 FPS em dez segundos, zero tarefas longas e busca em 114 ms. O ONNX empacotado produziu MIDI a partir do WAV gerado. O instalador foi gerado; sua instalação no sistema não foi executada.

Os artefatos do último smoke (release) ficam em `src-tauri/target/smoke`: resultado JSON, log e capturas do tocador, biblioteca, playlists, detalhe e layout compacto. Nenhuma URL real foi baixada novamente nesta etapa; download/transcrição e seus binários foram preservados, com regressões de contrato/cancelamento e execução ONNX real.

Teste de entrada e latência no jogo fica com o usuário, em terminal de administrador. Medições de apresentação e testes com dispositivo simulado não comprovam a latência final de SendInput no jogo.
