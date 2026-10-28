# Transporte e teclado

O plano usa `max(time + hold)` como duração. O relógio musical escala ataques e liberações pela velocidade; alterar velocidade recalcula os prazos restantes pela mesma posição musical. Notas inteiramente vencidas não são pressionadas atrasadas.

Reprodução manual inicia countdown nativo de cinco segundos. No final, o dispositivo captura uma janela externa; o próprio Tanzaku não é aceito. A perda de foco pausa e libera teclas, inclusive em silêncios. Home pausa e End para.

O worker é proprietário do estado das teclas. Repetir o mesmo scan code libera o dono anterior antes do novo ataque; um vencimento antigo não libera o novo dono. Mudanças de modificador são enviadas antes do ataque. Eventos visuais são confirmados depois de SendInput retornar sucesso.

Parar limpa a fila e invalida carregamentos/countdown. Pausar e buscar também liberam teclas. A fila só confirma seu próximo índice ao instalar o plano preparado. Próximas faixas preservam o alvo e não repetem countdown. Repetição individual reinicia a música; repetição de playlist reinicia sua fila e embaralha novamente no modo aleatório.

O encerramento solicita Shutdown e aguarda a liberação antes de terminar o worker. Timings de planejamento e resumo P95/máximo do despacho são registrados para diagnóstico; não medem o processamento interno do jogo.
