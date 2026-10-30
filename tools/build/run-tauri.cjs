const { spawnSync } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
if (process.platform === 'win32')
    require('../release/prepare-runtime.cjs').prepare()

const cargoBin = path.join(os.homedir(), '.cargo', 'bin')
const env = {
    ...process.env,
    PATH: `${cargoBin}${path.delimiter}${process.env.PATH ?? ''}`,
}
const executable = path.join(
    process.cwd(),
    'node_modules',
    '@tauri-apps',
    'cli',
    'tauri.js',
)
const result = spawnSync(
    process.execPath,
    [executable, ...process.argv.slice(2)],
    { env, stdio: 'inherit' },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
