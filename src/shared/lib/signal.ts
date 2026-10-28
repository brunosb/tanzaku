export function signal() {
    const listeners = new Set<() => void>()
    return {
        subscribe: (fn: () => void) => {
            listeners.add(fn)
            return () => {
                listeners.delete(fn)
            }
        },
        emit: () => {
            for (const fn of listeners) fn()
        },
    }
}
