import './tauri-bridge'
import './theme.css'
import 'sonner/dist/styles.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { createRuntime } from './runtime'

const target = document.getElementById('app')!
if (window.tanzaku) {
    const runtime = createRuntime(window.tanzaku)
    createRoot(target).render(<App runtime={runtime} />)
} else {
    target.textContent =
        'Abra o Tanzaku pelo aplicativo desktop para acessar sua biblioteca.'
}
