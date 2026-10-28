# Organização modular do Tanzaku

## Objetivo e referência

A reorganização parte do commit ea8b784. Ela mantém os nomes dos comandos IPC, formatos dos eventos e JSON, identidade do aplicativo, nome do executável e recursos empacotados. Não exige migração de dados. Há uma aplicação React e um crate Rust; não foi introduzido monorepo, novo gerenciador de estado ou framework de domínio.

## Estrutura e responsabilidades

| Local | Responsabilidade |
| --- | --- |
| src/main.tsx | Inicializar o bridge uma única vez, criar os estados e montar React |
| src/app | Compor funcionalidades, layout da janela, rotas, memória de navegação e host de diálogos |
| src/features/catalog/library | Página e apresentação da biblioteca |
| src/features/catalog/playlists | Grade, detalhe e painéis de seleção de playlists |
| src/features/catalog/import | Conversão YouTube e apresentação de progresso/cancelamento |
| src/features/catalog/model | Estado único do catálogo, filtros, seleção, contratos de ações e hooks |
| src/features/catalog/components | Tabela de músicas, controles compartilhados e edição do catálogo |
| src/features/playback | Tocador, transporte, estado recebido do Rust e controlador DOM do piano roll |
| src/features/settings | Confirmação visual da troca de armazenamento, recebendo callbacks |
| src/shared/api | TanzakuApi, tipos serializados e bridge Tauri |
| src/shared/ui | Componentes shadcn, seus hooks e apresentação comum de diálogos |
| src/shared/lib e src/shared/styles | Funções reutilizadas, sinais, notificações, tokens e estilos existentes |
| src-tauri/src/app.rs | Registrar comandos, inicializar serviços e coordenar encerramento |
| src-tauri/src/commands | Adaptar IPC por assunto e encaminhar trabalho bloqueante/controlador |
| src-tauri/src/music | Tipos musicais, leitura MIDI e planner das teclas |
| src-tauri/src/library | Modelos persistidos, arquivos MIDI, playlists, configurações e JSON atômico |
| src-tauri/src/playback | Controlador, ações, modelo, carregamento, eventos, worker e propriedade das teclas |
| src-tauri/src/transcription | Áudio, ambiente ONNX único, inferência, decoder e escrita do MIDI transcrito |
| src-tauri/src/youtube | Jobs, cancelamento de subprocessos, ferramentas nativas e pipeline de importação |
| src-tauri/src/platform | Entrada/foco do Windows e timer nativo |
| test/renderer, test/support e test/fixtures | Regressões da interface, infraestrutura de teste e referência Basic Pitch |
| tools/build, tools/smoke, tools/checks e tools/fixtures | Execução de ferramentas, integração desktop, regras de imports e geração de fixtures |
| dist | Única saída atual do build da interface, ignorada pelo Git |

Os testes Rust ficam junto dos respectivos módulos; os conjuntos extensos de reprodução, biblioteca e inferência usam arquivos próprios. bin, models, runtime, icons e capabilities permanecem no mesmo local dentro de src-tauri. O diretório target contém somente artefatos ignorados, incluindo o arquivo dos builds antigos em legacy-builds. A .venv e os caches locais foram preservados; Python continua opcional para regenerar fixtures.

## Dependências e estado

A direção da interface é app → features → shared. Funcionalidades não importam app; shared não importa funcionalidades nem composição. O catálogo pode consultar o contrato de metadados do estado de reprodução para indicar a música carregada. Isso não cria uma segunda fonte de verdade para transporte. Navegação é um callback, e seus dados de sessão pertencem a app/navigation. Tipos internos de contexto pertencem à funcionalidade que os consome.

A composição cria uma única instância do estado de catálogo, outra de reprodução e outra de navegação. O estado de catálogo conserva a fila serial de mutações e reconciliação após falhas. Eventos periódicos notificam somente assinantes de reprodução. Metadados têm um sinal separado, e as notas do piano roll são reconstruídas apenas quando o plano muda ou o contêiner é montado novamente. Ao desmontar, o controlador cancela animações e observadores. A composição de diálogos permanece fora das páginas, preservando progresso durante navegação.

npm run check:architecture verifica imports locais resolvidos, ausência de ciclos e as fronteiras descritas. Somente o bridge acessa window.__TAURI__. A verificação faz parte de npm test. Imports com efeitos colaterais são restritos à inicialização da interface e de estilos; não criar dependências ocultas por import dinâmico.

No Rust, módulos expõem somente a API necessária ao restante do crate; detalhes do transporte usam visibilidade limitada a playback. O worker conserva os corpos originais de run_worker, publish e release, desconsiderando formatação e visibilidade. Leitura e planejamento continuam fora do worker. O teclado, o dispositivo Windows e o timer não receberam novos relógios, filas ou threads.

O mutex de armazenamento continua único. As rotinas de baixo nível documentadas como dependentes de transaction exigem que o chamador mantenha o guard durante toda a operação. Os serviços CRUD de playlist extraídos dos comandos mantêm o guard internamente, exatamente onde a closure bloqueante o adquiria. Não aninhar aquisições do mesmo mutex. O módulo JSON mantém validação antes da escrita e substituição atômica. Alterar a organização de playlist não envia ações de reprodução.

## Como adicionar funcionalidades

1. **Página:** adicionar o componente na funcionalidade correspondente e conectar a rota em app. Fornecer navegação por callback. Estado de filtros/rolagem pertence à memória de navegação; dados persistidos pertencem ao catálogo. Não assinar progresso de reprodução em listas.
2. **Diálogo:** colocar o conteúdo na funcionalidade, usar a apresentação compartilhada e registrá-lo no host de app. Apresentação de armazenamento recebe callbacks; progresso de YouTube continua identificado pelo jobId do bridge.
3. **Comando nativo:** implementar a operação no subsistema Rust, expor um comando em commands e registrá-lo em app.rs. Atualizar TanzakuApi e o bridge juntos, com argumentos camelCase e testes que atravessem o contrato.
4. **Operação de biblioteca:** definir quem adquire transaction, validar tudo antes de gravar e usar as rotinas JSON existentes. Retornar o resultado confirmado; a interface atualiza o catálogo pela fila de mutações.
5. **Mudança musical:** manter MIDI/planner em music e agendamento em playback. Usar dispositivo simulado nos testes; qualquer alteração na lógica temporal exige regressões próprias e medição separada no jogo.
6. **Recurso nativo:** manter os caminhos usados no empacotamento, build e resolução em desenvolvimento sincronizados. Não converter caminhos de runtime em dependências da profundidade dos arquivos fonte. Fixtures Rust usam CARGO_MANIFEST_DIR.

Adicionar novas abstrações quando houver responsabilidades ou reutilização concretas. Não criar pastas vazias para funcionalidades futuras, nem arquivos que apenas encaminhem imports dos caminhos removidos.

## Verificação da reorganização

Validação em 28/10/2026:

- npm test: 26 testes da interface e 38 testes Rust passaram. O teste de WAV externo continua ignorado por depender de TANZAKU_TEST_WAV; o pipeline completo com áudio gerado executou ONNX e produziu MIDI.
- TypeScript, Biome, verificação de imports/ciclos, cargo fmt e Clippy com -D warnings passaram.
- A comparação estrutural com ea8b784 confirmou os corpos de run_worker, publish e release, sem alterações de algoritmo.
- Smoke real de WebView2/IPC passou em debug e release, com o plano de 1.871 eventos de DBZ Makafushigi. Validou edição e persistência de playlists, 51 seleções entre páginas, catálogo com 10.001 músicas, preservação do transporte e conversão WAV→MIDI com ONNX real.
- Debug inicial: 67,60 FPS em dez segundos, zero tarefas longas, busca de 10 mil músicas em 111 ms. Release: 66,56 FPS, zero tarefas longas e busca em 139 ms. Os tempos de busca incluem sincronização visual e CDP.
- Para comparar a medição histórica de 147,06 FPS, o bundle anterior preservado foi executado no mesmo ambiente atual e no mesmo backend: 68,44 FPS, zero tarefas longas e busca em 110 ms. As amostras atuais ficaram próximas; não demonstraram uma regressão relevante de apresentação causada pela reorganização. Não são uma garantia de FPS em outras condições.
- Após restaurar a configuração normal, o smoke debug final também passou: 67,12 FPS, zero tarefas longas e busca em 178 ms. O resultado final está em target/smoke; a primeira amostra debug foi preservada separadamente.
- O executável de release passou com PATH restrito a Windows/System32 e sem overrides de ferramentas/modelo, usando os recursos empacotados.
- O instalador NSIS foi gerado com sucesso em src-tauri/target/release/bundle/nsis/Tanzaku_0.1.0_x64-setup.exe, com 35.485.533 bytes (33,84 MiB). A instalação no sistema não foi executada.
- Os arquivos CSS de tema e apresentação conservam exatamente o conteúdo da referência. As capturas do tocador foram inspecionadas, com a mesma estrutura, cores e geometria do piano roll.

Os artefatos ficam em target/smoke, target/smoke-debug-modular, target/smoke-release-modular e target/smoke-baseline-current-environment dentro de src-tauri. O bundle antigo foi usado temporariamente via TAURI_CONFIG, sem modificar arquivos versionados; a configuração normal foi restaurada na execução final.

O teste no jogo permanece a cargo do usuário, usando terminal de administrador quando necessário. A integração desktop usa TANZAKU_DATA_DIR e perfil WebView temporários e não inicia o envio de teclas. Nenhuma URL real foi baixada novamente: a validação inclui regressões de jobs/cancelamento e transcrição ONNX real de um WAV gerado, sem avaliar a qualidade musical de uma nova gravação do YouTube.
