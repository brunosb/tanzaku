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
const bridge = fs
    .readFileSync(path.join(compiled, 'tauri-bridge.js'), 'utf8')
    .replace(
        /^"use strict";\r?\nObject\.defineProperty\(exports, "__esModule", \{ value: true \}\);\r?\n/,
        '"use strict";\n',
    )
if (bridge.includes('Object.defineProperty(exports')) {
    throw new Error('O bridge Tauri ainda foi gerado como CommonJS.')
}
fs.writeFileSync(path.join(destination, 'tauri-bridge.js'), bridge)
