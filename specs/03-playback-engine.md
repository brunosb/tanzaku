# Transporte e teclado

O plano usa `max(time + hold)` como duração. O relógio musical escala ataques e liberações pela velocidade; alterar velocidade recalcula os prazos restantes pela mesma posição musical. Notas inteiramente vencidas não são pressionadas atrasadas.

Reprodução manual inicia countdown nativo de cinco segundos. No final, o dispositivo captura uma janela externa; o próprio Tanzaku não é aceito. A perda de foco pausa e libera teclas, inclusive em silêncios. Home pausa e End para.

O worker é proprietário do estado das teclas. Repetir o mesmo scan code libera o dono anterior antes do novo ataque; um vencimento antigo não libera o novo dono. Mudanças de modificador são enviadas antes do ataque. Eventos visuais são confirmados depois de SendInput retornar sucesso.

Parar preserva o contexto da fila e invalida carregamentos/countdown. Pausar e buscar também liberam teclas. A fila só confirma seu próximo índice ao instalar o plano preparado; uma falha preserva plano, posição e fila anteriores, pausados. Próximas faixas automáticas preservam o alvo e não repetem countdown. Trocas manuais repetem a contagem se estavam tocando, em countdown ou pausadas por perda de foco; pausas manuais e parada apenas carregam o destino.

A fila atende biblioteca e playlist. A biblioteca recebe os IDs do resultado completo ordenado na interface; a playlist lê sua ordem original no momento da abertura. Os IDs e a ordem são congelados por execução, mas exclusões e nomes são atualizados. Repetir fila reinicia a lista e, no modo aleatório, prepara outra rodada sem repetição imediata quando há alternativas. A próxima rodada é reservada antes de ser anunciada, para que o próximo título coincida com a faixa efetivamente carregada.

Aleatório mantém a música atual e embaralha as outras faixas em uma nova rodada. O histórico permite voltar e avançar pelas mesmas escolhas, inclusive entre rodadas repetidas. Desativar Aleatório restaura o índice da faixa na ordem original. Metadados da fila entram em Snapshot/playback-plan, separados dos eventos periódicos de posição, e chegam ao renderer por playback.onQueue. Os comandos playback_previous, playback_next e playback_set_shuffle são processados pelo mesmo worker proprietário das teclas.

O encerramento solicita Shutdown e aguarda a liberação antes de terminar o worker. Timings de planejamento e resumo P95/máximo do despacho são registrados para diagnóstico; não medem o processamento interno do jogo.
