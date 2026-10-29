# Piano roll e interface

O piano roll possui 21 linhas físicas agrupadas em baixo/médio/alto; naturais e acidentes usam os rótulos e modificadores do plano das 36 alturas. A posição usa 120 px por segundo musical e a largura da nota é sua duração real no plano.

Apenas um carregamento de plano reconstrói o DOM. Elementos de notas são guardados por índice; classes de eventos passados e do conjunto ativo são atualizadas por diferenças. A última nota iniciada não representa sozinha o conjunto de sustains.

React mantém o contêiner; `piano-controller.ts` cria e atualiza as notas fora da reconciliação React. Sair da página desmonta o controlador e cancela animação/observador; voltar reconstrói pela versão atual do plano. A barra de transporte mantém sua animação separada das páginas de catálogo.

O transporte tem duas linhas: música, contexto da fila e controles na primeira; tempos e forma de onda na segunda. O cabeçalho do tocador apresenta a origem, o modo, o índice e a próxima música. Anterior/Próxima e Aleatório são desabilitados durante carregamento/countdown, e destinos ausentes desabilitam a respectiva ação.

A forma de onda usa Recharts com barras de intervalo espelhadas, sem eixos, animação interna ou interação do gráfico. O nível de cada janela deriva da ocupação das notas do plano, normalizada por faixa, preservando silêncios. A quantidade de amostras acompanha a largura entre 48 e 240; o cálculo usa diferenças de intervalos e tem custo linear em eventos mais amostras.

Duas camadas estáticas compartilham os dados: a base cinza azulada e o degradê dourado revelado por clip-path. O relógio visual move apenas o recorte e o marcador. O slider HTML transparente sobreposto continua responsável por mouse, toque, teclado e acessibilidade, com o mesmo recuo de oito pixels do gráfico para alinhar o thumb. A altura é de 40 px, reduzida a 28 px quando a janela tem até 700 px de altura.

O conjunto ativo vem do worker e é limitado pelo fim visual da nota. Pausa, parada e descarregamento limpam destaques. A interpolação do cursor é somente apresentação, limitada a 100 ms sem novos snapshots. Nenhum timer do renderer dispara notas, countdown ou próxima faixa.

Título, plano e estado pertencem à mesma geração. A janela possui região de arraste Tauri e tratamento das rejeições dos controles. Progresso de YouTube é associado ao jobId; cancelar ou trocar o modal impede atualizações da operação anterior.
