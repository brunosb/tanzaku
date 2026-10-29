const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const tag = process.argv[2]
execFileSync(process.execPath, ['tools/checks/check-version.cjs', tag], {
    stdio: 'inherit',
})
const directory = 'src-tauri/target/release/bundle/nsis'
const version = require('../../package.json').version
const installers = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(`_${version}_x64-setup.exe`))
if (installers.length !== 1) throw new Error('Expected exactly one installer')
const file = path.join(directory, installers[0])
const hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex')
const checksum = path.join(directory, 'SHA256SUMS.txt')
fs.writeFileSync(checksum, `${hash}  ${installers[0]}\n`)
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })
const release = JSON.parse(
    gh(['release', 'view', tag, '--json', 'isDraft,assets']),
)
if (!release.isDraft) {
    if (!release.assets.some((asset) => asset.name === 'SHA256SUMS.txt'))
        throw new Error('Published release is missing checksums')
    console.log(`Release ${tag} is already published; assets were preserved.`)
} else {
    gh(['release', 'upload', tag, file, checksum, '--clobber'])
    gh(['release', 'edit', tag, '--draft=false', '--latest'])
    console.log(`Published ${tag}: ${installers[0]} (${hash})`)
}
