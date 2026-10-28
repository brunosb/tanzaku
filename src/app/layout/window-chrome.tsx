import { Maximize2, Minus, X } from 'lucide-react'
import type { TanzakuApi } from '@/shared/api/contracts'
import { run } from '@/shared/lib/report-error'
import { AppLogo } from '@/shared/ui/app-logo'
export function WindowChrome({ api }: { api: TanzakuApi }) {
    return (
        <header className="window-chrome">
            <div className="window-drag" data-tauri-drag-region>
                <AppLogo className="window-mark" dragRegion />
                <span data-tauri-drag-region>Tanzaku</span>
            </div>
            <div className="window-actions">
                <button
                    aria-label="Minimizar"
                    className="window-action"
                    onClick={() => run(api.window.minimize())}
                >
                    <Minus size={14} />
                </button>
                <button
                    aria-label="Maximizar"
                    className="window-action"
                    onClick={() => run(api.window.toggleMaximize())}
                >
                    <Maximize2 size={12} />
                </button>
                <button
                    aria-label="Fechar"
                    className="window-action close"
                    onClick={() => run(api.window.close())}
                >
                    <X size={16} />
                </button>
            </div>
        </header>
    )
}
