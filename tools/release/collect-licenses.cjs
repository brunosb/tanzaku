const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, 'src-tauri/licenses/generated')
fs.mkdirSync(output, { recursive: true })
fs.copyFileSync(
    path.join(root, 'LICENSE'),
    path.join(root, 'src-tauri/licenses/TANZAKU-LICENSE.txt'),
)
const licensePattern = /^(licen[cs]e|copying|notice)([._-].*)?$/i
function notice(name, version, license, directory, licenseFile) {
    const files = new Set(
        fs.readdirSync(directory).filter((file) => licensePattern.test(file)),
    )
    if (licenseFile) files.add(licenseFile)
    const texts = [...files]
        .filter((file) => fs.statSync(path.join(directory, file)).isFile())
        .map(
            (file) =>
                `--- ${file} ---\n${fs.readFileSync(path.join(directory, file), 'utf8')}`,
        )
    return `\n${'='.repeat(72)}\n${name} ${version} (${license || 'See package source'})\n${texts.join('\n')}\n`
}
const lock = JSON.parse(
    fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
)
const frontend = Object.entries(lock.packages)
    .filter(
        ([location, pkg]) =>
            location && !pkg.dev && fs.existsSync(path.join(root, location)),
    )
    .map(([location, pkg]) =>
        notice(
            location.replace(/^.*node_modules\//, ''),
            pkg.version,
            pkg.license,
            path.join(root, location),
        ),
    )
fs.writeFileSync(path.join(output, 'FRONTEND.txt'), frontend.join('\n'))
const cargo = path.join(
    os.homedir(),
    '.cargo/bin',
    process.platform === 'win32' ? 'cargo.exe' : 'cargo',
)
const metadata = JSON.parse(
    execFileSync(
        cargo,
        [
            'metadata',
            '--manifest-path',
            'src-tauri/Cargo.toml',
            '--locked',
            '--format-version=1',
            '--filter-platform',
            'x86_64-pc-windows-msvc',
        ],
        { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    ),
)
const rust = metadata.packages
    .filter((pkg) => pkg.source)
    .map((pkg) =>
        notice(
            pkg.name,
            pkg.version,
            pkg.license,
            path.dirname(pkg.manifest_path),
            pkg.license_file,
        ),
    )
fs.writeFileSync(path.join(output, 'RUST.txt'), rust.join('\n'))
console.log(
    `Collected notices for ${frontend.length} frontend packages and ${rust.length} Rust crates`,
)
