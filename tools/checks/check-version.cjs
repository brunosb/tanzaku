const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))
const version = json('package.json').version
assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
const cargo = read('src-tauri/Cargo.toml')
    .split(/^\[/m)
    .find((part) => part.startsWith('package]'))
const locked = read('src-tauri/Cargo.lock')
    .split('[[package]]')
    .find((part) => /^\s*name = "tanzaku-tauri-experiment"/m.test(part))
for (const [name, actual] of Object.entries({
    'package-lock.json': json('package-lock.json').version,
    'package-lock root': json('package-lock.json').packages[''].version,
    Tauri: json('src-tauri/tauri.conf.json').version,
    Cargo: cargo?.match(/^version = "([^"]+)"/m)?.[1],
    'Cargo lock': locked?.match(/^version = "([^"]+)"/m)?.[1],
}))
    assert.equal(actual, version, `${name} must match ${version}`)
const released = json('.release-please-manifest.json')['.']
if (released)
    assert.equal(released, version, 'Release manifest must match app version')
if (process.argv[2])
    assert.equal(
        process.argv[2],
        `v${version}`,
        'Release tag must match app version',
    )
console.log(`All application versions match ${version}`)
