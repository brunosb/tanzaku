const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const compiled = path.join(root, 'dist-renderer')
const destination = path.join(root, 'dist-tauri')
// Fixed output directories inside this checkout; no user MIDI storage is touched.
fs.rmSync(destination, { recursive: true, force: true })
fs.mkdirSync(destination, { recursive: true })
for (const file of fs.readdirSync(compiled))
    if (file.endsWith('.js'))
        fs.copyFileSync(path.join(compiled, file), path.join(destination, file))
for (const file of ['index.html', 'styles.css'])
    fs.copyFileSync(
        path.join(root, 'src', 'renderer', file),
        path.join(destination, file),
    )
fs.writeFileSync(
    path.join(compiled, 'package.json'),
    JSON.stringify({ type: 'module' }),
)
