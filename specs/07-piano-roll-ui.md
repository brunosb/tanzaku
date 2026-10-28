# Piano roll e interface

O piano roll possui 21 linhas físicas agrupadas em baixo/médio/alto; naturais e acidentes usam os rótulos e modificadores do plano das 36 alturas. A posição usa 120 px por segundo musical e a largura da nota é sua duração real no plano.

Apenas um carregamento de plano reconstrói o DOM. Elementos de notas são guardados por índice; classes de eventos passados e do conjunto ativo são atualizadas por diferenças. A última nota iniciada não representa sozinha o conjunto de sustains.

O conjunto ativo vem do worker e é limitado pelo fim visual da nota. Pausa, parada e descarregamento limpam destaques. A interpolação do cursor é somente apresentação, limitada a 100 ms sem novos snapshots. Nenhum timer do renderer dispara notas, countdown ou próxima faixa.

Título, plano e estado pertencem à mesma geração. A janela possui região de arraste Tauri e tratamento das rejeições dos controles. Progresso de YouTube é associado ao jobId; cancelar ou trocar o modal impede atualizações da operação anterior.
