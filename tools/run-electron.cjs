const { spawn } = require('node:child_process')

const electron = require('electron')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE

const child = spawn(electron, process.argv.slice(2), {
    env: environment,
    stdio: 'inherit',
    windowsHide: false,
})

child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
})

child.on('error', (error) => {
    console.error(`Falha ao iniciar o Electron: ${error.message}`)
    process.exitCode = 1
})
