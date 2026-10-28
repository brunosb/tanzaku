import logo from '@/shared/assets/branding/tanzaku-512.png'
import { cn } from '@/shared/lib/utils'

export function AppLogo({
    className,
    dragRegion = false,
}: {
    className?: string
    dragRegion?: boolean
}) {
    return (
        <img
            src={logo}
            alt=""
            aria-hidden="true"
            draggable={false}
            data-tauri-drag-region={dragRegion || undefined}
            width={512}
            height={512}
            className={cn('app-logo', className)}
        />
    )
}
