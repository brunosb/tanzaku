const fs = require('node:fs')
const path = require('node:path')
const { inspect, verify } = require('./pe.cjs')
const manifest = require('./runtime-manifest.json')
// Explicit Windows components: do not accept arbitrary DLLs found on the developer's PATH/System32.
const system = new Set(
    'advapi32 avrt bcrypt bcryptprimitives crypt32 cryptbase cryptsp cfgmgr32 comctl32 combase comdlg32 dbghelp dbgcore dnsapi dwmapi dxgi d3d11 d3d12 dxcore gdi32 imm32 iphlpapi kernel32 kernelbase mpr msimg32 msvcrt ncrypt netapi32 normaliz ntdll ole32 oleacc oleaut32 opengl32 powrprof profapi propsys psapi rpcrt4 secur32 setupapi shell32 shlwapi user32 userenv usp10 uxtheme version win32u winhttp wininet winmm winspool.drv ws2_32 wtsapi32 avicap32 wintrust wldap32 sensapi mswsock cabinet hid mf mfplat mfuuid rstrtmgr'
        .split(' ')
        .map((n) => (n.endsWith('.drv') ? n : n + '.dll')),
)
function walk(root) {
    return fs
        .readdirSync(root, { withFileTypes: true })
        .flatMap((entry) =>
            entry.isDirectory()
                ? walk(path.join(root, entry.name))
                : [path.join(root, entry.name)],
        )
}
function auditImports(
    root,
    files = walk(root).filter(
        (file) => /\.(exe|dll)$/i.test(file) && !/uninstall\.exe$/i.test(file),
    ),
) {
    const records = []
    for (const file of files) {
        const info = inspect(fs.readFileSync(file))
        for (const dependency of info.imports) {
            if (
                /^(api-ms-win-|ext-ms-win-)/.test(dependency) ||
                system.has(dependency)
            )
                continue
            const candidates = [path.join(path.dirname(file), dependency)]
            if (/\.dll$/i.test(file))
                candidates.push(path.join(root, dependency))
            if (!candidates.some((candidate) => fs.existsSync(candidate)))
                throw new Error(
                    `${path.relative(root, file)} requires unpackaged ${dependency}`,
                )
        }
        records.push({ path: path.relative(root, file), ...info })
    }
    return records
}
function audit(directory) {
    const root = path.resolve(directory)
    for (const file of [
        ...manifest.files,
        ...manifest.downloads.flatMap((d) => d.outputs),
    ]) {
        // CRT is installed app-local, not in runtime/crt.
        const relative = file.path.startsWith('runtime/crt/')
            ? path.basename(file.path)
            : file.path
        verify(path.join(root, relative), file.sha256)
    }
    const walk = (dir) =>
        fs
            .readdirSync(dir, { withFileTypes: true })
            .flatMap((entry) =>
                entry.isDirectory()
                    ? walk(path.join(dir, entry.name))
                    : [path.join(dir, entry.name)],
            )
    const files = walk(root).filter(
        (file) => /\.(exe|dll)$/i.test(file) && !/uninstall\.exe$/i.test(file),
    )
    return { platform: manifest.platform, files: auditImports(root, files) }
}
if (require.main === module) {
    try {
        console.log(JSON.stringify(audit(process.argv[2]), null, 2))
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}
module.exports = { audit, auditImports }
