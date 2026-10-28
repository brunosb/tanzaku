import { useLayoutEffect, useRef } from 'react'
import type { Runtime } from '../runtime'
export function ScrollPage({
    runtime,
    route,
    children,
}: {
    runtime: Runtime
    route: string
    children: React.ReactNode
}) {
    const ref = useRef<HTMLElement>(null)
    useLayoutEffect(() => {
        ref.current!.scrollTop = runtime.navigation.scrolls.get(route) ?? 0
    }, [runtime, route])
    return (
        <main
            ref={ref}
            tabIndex={-1}
            className={`main-content ${route === '/player' ? 'player-page' : ''}`}
            onScroll={(e) =>
                runtime.navigation.scrolls.set(route, e.currentTarget.scrollTop)
            }
        >
            {children}
        </main>
    )
}
