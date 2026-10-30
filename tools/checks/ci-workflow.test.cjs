const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const { classifyReleasePullRequest } = require('../ci/classify-release-pr.cjs')
const {
    verifyInstallerArtifact,
} = require('../release/verify-installer-manifest.cjs')

const repository = 'brunosb/tanzaku'
const sha = (letter) => letter.repeat(40)

test('Commitlint accepts the Release Please title through stdin', () => {
    const cli = path.resolve('node_modules/@commitlint/cli/cli.js')
    const result = spawnSync(
        process.execPath,
        [cli, '--config', 'commitlint.config.cjs'],
        {
            cwd: path.resolve(__dirname, '../..'),
            input: 'chore(main): release 1.1.0\n',
            encoding: 'utf8',
            windowsHide: true,
        },
    )
    if (result.error) throw result.error
    assert.equal(
        result.status,
        0,
        `Release Please title failed Commitlint: ${result.stdout}${result.stderr}`,
    )
})

const releaseEvent = (overrides = {}) => ({
    action: 'synchronize',
    pull_request: {
        title: 'chore(main): release 1.1.0',
        user: { login: 'github-actions[bot]' },
        head: {
            ref: 'release-please--branches--main--components--tanzaku',
            repo: { full_name: repository },
        },
        ...overrides,
    },
})

test('Release Please classifier requires the trusted same-repository bot PR', () => {
    const files = [
        '.release-please-manifest.json',
        'CHANGELOG.md',
        'package.json',
        'package-lock.json',
        'src-tauri/Cargo.toml',
        'src-tauri/Cargo.lock',
        'src-tauri/tauri.conf.json',
    ]
    assert.equal(
        classifyReleasePullRequest({
            event: releaseEvent(),
            repository,
            changedFiles: files,
        }),
        true,
    )
    assert.equal(
        classifyReleasePullRequest({
            event: releaseEvent({
                head: {
                    ref: 'release-please--fake',
                    repo: { full_name: 'fork/tanzaku' },
                },
            }),
            repository,
            changedFiles: files,
        }),
        false,
    )
    assert.equal(
        classifyReleasePullRequest({
            event: releaseEvent({ user: { login: 'contributor' } }),
            repository,
            changedFiles: files,
        }),
        false,
    )
    assert.equal(
        classifyReleasePullRequest({
            event: releaseEvent({
                head: {
                    ref: 'release-please--fake',
                    repo: { full_name: repository },
                },
            }),
            repository,
            changedFiles: files,
        }),
        false,
    )
    assert.equal(
        classifyReleasePullRequest({
            event: releaseEvent({
                head: {
                    ref: 'prefix-release-please--fake',
                    repo: { full_name: repository },
                },
            }),
            repository,
            changedFiles: files,
        }),
        false,
    )
})

test('Release Please classifier rejects code and unexpected metadata changes', () => {
    assert.throws(
        () =>
            classifyReleasePullRequest({
                event: releaseEvent(),
                repository,
                changedFiles: ['package.json', 'src-tauri/src/app.rs'],
            }),
        /out-of-scope files/,
    )
    assert.throws(
        () =>
            classifyReleasePullRequest({
                event: releaseEvent({ title: 'chore: update versions' }),
                repository,
                changedFiles: ['package.json'],
            }),
        /expected release title/,
    )
})

function makeArtifact(t, overrides = {}) {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'tanzaku-artifact-'),
    )
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const version = '1.1.0'
    const tag = `v${version}`
    const installerName = `Tanzaku_${version}_x64-setup.exe`
    const bytes = Buffer.from('installer fixture')
    const manifest = {
        schemaVersion: 1,
        releaseTag: tag,
        version,
        sourceHeadSha: sha('a'),
        pullRequest: 8,
        testedCommitSha: sha('b'),
        testedTreeSha: sha('c'),
        installer: {
            name: installerName,
            size: bytes.byteLength,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            architecture: 'x64',
        },
        ...overrides.manifest,
    }
    fs.writeFileSync(path.join(directory, installerName), bytes)
    fs.writeFileSync(
        path.join(directory, 'artifact-manifest.json'),
        JSON.stringify(manifest),
    )
    return {
        directory,
        tag,
        version,
        manifest,
        verify: (extra = {}) =>
            verifyInstallerArtifact({
                tag,
                version,
                tagTreeSha: sha('c'),
                artifactDirectory: directory,
                expectedSourceHeadSha: sha('a'),
                ...extra,
            }),
    }
}

test('installer artifact requires version, exact tree, source and bytes to match', (t) => {
    const artifact = makeArtifact(t)
    assert.equal(
        artifact.verify().installer.sha256,
        artifact.manifest.installer.sha256,
    )
    assert.throws(
        () => artifact.verify({ expectedPullRequest: 9 }),
        /another Release Please PR/,
    )
    assert.throws(
        () => artifact.verify({ tagTreeSha: sha('d') }),
        /another source tree/,
    )
    assert.throws(
        () => artifact.verify({ expectedSourceHeadSha: sha('d') }),
        /another Release Please head/,
    )

    fs.writeFileSync(
        path.join(artifact.directory, artifact.manifest.installer.name),
        'altered installer',
    )
    assert.throws(() => artifact.verify(), /SHA-256 differs from manifest/)
})

test('installer artifact rejects extra files and wrong release versions', (t) => {
    const artifact = makeArtifact(t)
    fs.writeFileSync(path.join(artifact.directory, 'extra.exe'), 'unexpected')
    assert.throws(() => artifact.verify(), /only installer and manifest/)
    assert.throws(
        () => artifact.verify({ tag: 'v1.2.0' }),
        /tag and checked-out package version differ/,
    )
})

test('installer artifact accepts a single nested download-artifact folder', (t) => {
    const artifact = makeArtifact(t)
    const originalFiles = fs.readdirSync(artifact.directory)
    const nested = path.join(artifact.directory, 'downloaded-artifact')
    fs.mkdirSync(nested)
    for (const name of originalFiles) {
        fs.renameSync(
            path.join(artifact.directory, name),
            path.join(nested, name),
        )
    }
    assert.equal(
        artifact.verify().installer.name,
        'Tanzaku_1.1.0_x64-setup.exe',
    )
    fs.writeFileSync(path.join(artifact.directory, 'unexpected.txt'), 'extra')
    assert.throws(() => artifact.verify(), /only installer and manifest/)
})

test('recovery artifacts must be built from the release tag commit', (t) => {
    const artifact = makeArtifact(t, {
        manifest: { sourceHeadSha: sha('b'), pullRequest: null },
    })
    assert.equal(
        artifact.verify({
            expectedSourceHeadSha: undefined,
            tagCommitSha: sha('b'),
        }).sourceHeadSha,
        sha('b'),
    )
    assert.throws(
        () =>
            artifact.verify({
                expectedSourceHeadSha: undefined,
                tagCommitSha: sha('d'),
            }),
        /release tag commit/,
    )
})
