# Armazenamento e biblioteca

Os JSONs e a pasta `midi` permanecem no formato anterior. IDs existentes são preservados, inclusive ao renomear. Novos IDs são independentes do nome do arquivo.

Uma transação global serializa a leitura/modificação/gravação dos índices e a troca da raiz. Arquivo ausente permite biblioteca nova; JSON inválido ou ilegível retorna erro e impede sobrescrita silenciosa. Gravação usa NamedTempFile no mesmo diretório, sync e persistência atômica.

Importações validam o MIDI antes de adicionar o registro. Renomeação reverte o arquivo se a gravação do índice falhar. Exclusão valida biblioteca e playlists, move o MIDI para um nome temporário e atualiza ambos os índices; em falha, tenta restaurar índices e arquivo.

Excluir uma faixa carregada ou trocar a raiz também descarrega o backend. A troca de raiz cancela a conversão ativa. Configurações do Rust são a autoridade da pasta escolhida; localStorage do WebView não substitui essa seleção.
