const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const [sourceHeadArgument, pullRequestArgument, outputDirectory] =
    process.argv.slice(2)
assert.ok(
    outputDirectory,
    'expected source SHA, PR number and output directory',
)
const tag = process.env.RELEASE_TAG
assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
const version = require('../../package.json').version
assert.equal(tag, `v${version}`, 'release tag and package version must match')

const revision = (...args) =>
    execFileSync('git', ['rev-parse', ...args], { encoding: 'utf8' }).trim()
const testedCommitSha = revision('HEAD')
const testedTreeSha = revision('HEAD^{tree}')

let sourceHeadSha
let pullRequest
if (sourceHeadArgument === '-') {
    sourceHeadSha = revision(`${tag}^{commit}`)
    pullRequest = null
    assert.equal(
        testedTreeSha,
        revision(`${tag}^{tree}`),
        'recovery build checkout must match the existing release tag tree',
    )
} else {
    assert.match(sourceHeadArgument, /^[0-9a-f]{40}$/i)
    assert.match(pullRequestArgument ?? '', /^\d+$/)
    sourceHeadSha = sourceHeadArgument
    pullRequest = Number(pullRequestArgument)
}

const bundleDirectory = path.resolve('src-tauri/target/release/bundle/nsis')
const installers = fs
    .readdirSync(bundleDirectory)
    .filter((name) => name === `Tanzaku_${version}_x64-setup.exe`)
assert.equal(installers.length, 1, 'expected one installer for this version')
const installerName = installers[0]
const installerPath = path.join(bundleDirectory, installerName)
const installer = fs.readFileSync(installerPath)
const manifest = {
    schemaVersion: 1,
    releaseTag: tag,
    version,
    sourceHeadSha,
    pullRequest,
    testedCommitSha,
    testedTreeSha,
    installer: {
        name: installerName,
        size: installer.byteLength,
        sha256: crypto.createHash('sha256').update(installer).digest('hex'),
        architecture: 'x64',
    },
}

fs.mkdirSync(outputDirectory, { recursive: true })
fs.copyFileSync(installerPath, path.join(outputDirectory, installerName))
fs.writeFileSync(
    path.join(outputDirectory, 'artifact-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
)
console.log(
    `Prepared ${installerName} (${installer.byteLength} bytes, ${manifest.installer.sha256})`,
)
