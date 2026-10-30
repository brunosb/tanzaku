const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { verify } = require('./pe.cjs')
const manifest = require('./runtime-manifest.json')
const root = path.resolve(__dirname, '../../src-tauri')
const cache = path.join(root, 'target/dependency-cache')
const quote = (text) => `'${text.replaceAll("'", "''")}'`
const powershell = (script) =>
    execFileSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$ErrorActionPreference = 'Stop'; ${script}`,
        ],
        { stdio: 'inherit', windowsHide: true },
    )

function prepare(verifyOnly = false) {
    if (!verifyOnly) fs.mkdirSync(cache, { recursive: true })
    for (const download of manifest.downloads) {
        const ready = download.outputs.every((out) => {
            try {
                verify(path.join(root, out.path), out.sha256)
                return true
            } catch {
                return false
            }
        })
        if (!ready && !verifyOnly) {
            const archive = path.join(cache, download.cache)
            let valid = false
            try {
                verify(archive, download.sha256)
                valid = true
            } catch {
                /* Download again; never trust an unchecked cache. */
            }
            if (!valid) {
                console.log(`Downloading ${download.name} ${download.version}`)
                const temporary = archive + '.download'
                powershell(
                    `Invoke-WebRequest -UseBasicParsing -Uri ${quote(download.url)} -OutFile ${quote(temporary)}`,
                )
                verify(temporary, download.sha256)
                fs.renameSync(temporary, archive)
            }
            for (const out of download.outputs) {
                const destination = path.join(root, out.path)
                fs.mkdirSync(path.dirname(destination), { recursive: true })
                if (out.entry) {
                    powershell(
                        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $package = [IO.Compression.ZipFile]::OpenRead(${quote(archive)}); try { [IO.Compression.ZipFileExtensions]::ExtractToFile($package.GetEntry(${quote(out.entry)}), ${quote(destination)}, $true) } finally { $package.Dispose() }`,
                    )
                } else fs.copyFileSync(archive, destination)
            }
        }
        for (const out of download.outputs)
            verify(path.join(root, out.path), out.sha256)
    }
    for (const file of manifest.files)
        verify(path.join(root, file.path), file.sha256)
    const crt = manifest.downloads.find((item) =>
        item.name.startsWith('Microsoft'),
    ).outputs
    for (const out of crt) {
        // Main process resolves ONNX dependencies here; child processes resolve theirs in bin/.
        for (const directory of [root, path.join(root, 'bin')]) {
            const destination = path.join(directory, path.basename(out.path))
            if (!verifyOnly)
                fs.copyFileSync(path.join(root, out.path), destination)
            verify(destination, out.sha256)
        }
    }
    const record = path.join(root, 'runtime/distribution.json')
    if (!verifyOnly)
        fs.writeFileSync(record, JSON.stringify(manifest, null, 4) + '\n')
    console.log('Pinned Windows x64 runtime resources verified.')
}
if (require.main === module) {
    try {
        prepare(process.argv.includes('--verify'))
    } catch (error) {
        console.error(
            `Runtime preparation failed: ${error.message}. Run npm run runtime:prepare (and git lfs pull for FFmpeg).`,
        )
        process.exitCode = 1
    }
}
module.exports = { prepare }
