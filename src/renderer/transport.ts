export function formatTransportTime(seconds: number): string {
    const safe = Math.max(0, seconds)
    return `${Math.floor(safe / 60)
        .toString()
        .padStart(2, '0')}:${Math.floor(safe % 60)
        .toString()
        .padStart(2, '0')}`
}
