# 07 — Piano roll

Desenhar cada evento com posição horizontal pelo tempo inicial, largura pela duração, linha pela tecla/pitch e cor para natural, SHIFT ou CTRL. Exibir cursor, nota atual, tecla WWM, modificador, tempo, duração, eventos futuros/executados e descartes/limite de polifonia.

Seek limita a posição a `0..duration`, libera teclas antes de reposicionar e inicia contagem regressiva ao retomar. `requestAnimationFrame` serve somente para renderização; o relógio oficial é o `PlaybackEngine`. O renderer não altera o plano.
