const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'dist-renderer')
fs.rmSync(output, { recursive: true, force: true })
let result = spawnSync(
    process.execPath,
    [
        require.resolve('typescript/bin/tsc'),
        '-p',
        path.join(root, 'tsconfig.renderer.json'),
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true },
)
if (result.error) throw result.error
if (result.status) process.exit(result.status)
result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'prepare-tauri-ui.cjs')],
    { cwd: root, stdio: 'inherit', windowsHide: true },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
