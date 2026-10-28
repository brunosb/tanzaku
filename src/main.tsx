import { createRoot } from 'react-dom/client'
import 'sonner/dist/styles.css'
import { App } from './app/app'
import { createRuntime } from './app/runtime'
import './shared/api/tauri-bridge'
import './shared/styles/styles.css'
import './shared/styles/theme.css'

const target = document.getElementById('app')!
if (window.tanzaku) {
    const runtime = createRuntime(window.tanzaku)
    createRoot(target).render(<App runtime={runtime} />)
} else {
    target.textContent =
        'Abra o Tanzaku pelo aplicativo desktop para acessar sua biblioteca.'
}
