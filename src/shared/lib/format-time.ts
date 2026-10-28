export function formatTime(seconds: number) {
    const safe = Math.max(0, Math.floor(seconds))
    const h = Math.floor(safe / 3600)
    return `${h ? `${String(h).padStart(2, '0')}:` : ''}${String(Math.floor(safe / 60) % 60).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}
