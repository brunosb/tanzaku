import type { AppSettings, ShortcutAction } from './contracts'

export const shortcutLabels: Record<ShortcutAction, string> = {
    pause: 'Pausar',
    stop: 'Parar',
    play: 'Reproduzir / Continuar',
    previous: 'Faixa anterior',
    next: 'Próxima faixa',
    seekBackward: 'Retroceder 5 segundos',
    seekForward: 'Avançar 5 segundos',
}
export const defaultShortcuts: AppSettings['shortcuts'] = {
    pause: 'Control+Alt+Home',
    stop: 'Control+Alt+End',
    play: 'Control+Alt+Insert',
    previous: 'Control+Alt+PageUp',
    next: 'Control+Alt+PageDown',
    seekBackward: 'Control+Alt+ArrowLeft',
    seekForward: 'Control+Alt+ArrowRight',
}
