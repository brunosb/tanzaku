const { spawn } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
if (
    process.platform === 'win32' &&
    process.argv.some((arg) => ['run', 'test', 'check', 'build'].includes(arg))
) {
    try {
        require('../release/prepare-runtime.cjs').prepare()
    } catch (error) {
        console.error(error.message)
        process.exit(1)
    }
}

const cargo =
    process.platform === 'win32'
        ? path.join(os.homedir(), '.cargo', 'bin', 'cargo.exe')
        : 'cargo'

const child = spawn(cargo, process.argv.slice(2), {
    cwd: path.resolve(__dirname, '../..'),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
})

child.once('error', (error) => {
    console.error(`Falha ao iniciar cargo: ${error.message}`)
    process.exitCode = 1
})

child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
})
