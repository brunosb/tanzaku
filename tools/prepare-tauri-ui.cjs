const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'src', 'renderer')
const compiled = path.join(root, 'dist-electron', 'renderer')
const destination = path.join(root, 'dist-tauri')

fs.rmSync(destination, { recursive: true, force: true })
fs.mkdirSync(destination, { recursive: true })
fs.copyFileSync(
    path.join(source, 'styles.css'),
    path.join(destination, 'styles.css'),
)

const html = fs
    .readFileSync(path.join(source, 'index.html'), 'utf8')
    .replace(
        '<script src="../../dist-electron/renderer/app.js"></script>',
        '<script src="tauri-bridge.js"></script>\n    <script src="app.js"></script>',
    )
fs.writeFileSync(path.join(destination, 'index.html'), html)
fs.copyFileSync(path.join(compiled, 'app.js'), path.join(destination, 'app.js'))
fs.copyFileSync(
    path.join(compiled, 'tauri-bridge.js'),
    path.join(destination, 'tauri-bridge.js'),
)
