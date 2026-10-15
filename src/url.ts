export function isYoutubeUrl(input: string) {
    try {
        const url = new URL(input)
        return (
            ['http:', 'https:'].includes(url.protocol) &&
            (/^(www\.)?youtube\.com$/i.test(url.hostname) ||
                url.hostname.toLowerCase() === 'youtu.be')
        )
    } catch {
        return false
    }
}
