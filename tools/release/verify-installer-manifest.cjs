const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function verifyInstallerArtifact({
    tag,
    version,
    tagTreeSha,
    artifactDirectory,
    expectedSourceHeadSha,
    expectedPullRequest,
    tagCommitSha,
}) {
    assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
    assert.equal(
        tag,
        `v${version}`,
        'tag and checked-out package version differ',
    )

    const directory = path.resolve(artifactDirectory)
    const entries = fs.readdirSync(directory).sort()
    assert.equal(
        entries.length,
        2,
        'artifact must contain only installer and manifest',
    )
    assert.ok(entries.includes('artifact-manifest.json'))
    const expectedInstaller = `Tanzaku_${version}_x64-setup.exe`
    assert.ok(
        entries.includes(expectedInstaller),
        'versioned x64 installer is missing',
    )

    const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, 'artifact-manifest.json'), 'utf8'),
    )
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.releaseTag, tag)
    assert.equal(manifest.version, version)
    assert.equal(
        manifest.testedTreeSha,
        tagTreeSha,
        'artifact was built from another source tree',
    )
    assert.equal(manifest.installer?.name, expectedInstaller)
    assert.equal(manifest.installer?.architecture, 'x64')

    if (expectedSourceHeadSha) {
        assert.equal(
            manifest.sourceHeadSha,
            expectedSourceHeadSha,
            'artifact came from another Release Please head commit',
        )
        assert.match(manifest.sourceHeadSha, /^[0-9a-f]{40}$/i)
        assert.match(manifest.testedCommitSha, /^[0-9a-f]{40}$/i)
        assert.match(manifest.testedTreeSha, /^[0-9a-f]{40}$/i)
        assert.ok(Number.isInteger(manifest.pullRequest))
        if (expectedPullRequest !== undefined) {
            assert.equal(
                manifest.pullRequest,
                Number(expectedPullRequest),
                'artifact came from another Release Please PR',
            )
        }
    } else {
        assert.equal(
            manifest.sourceHeadSha,
            tagCommitSha,
            'recovery artifact source must be the release tag commit',
        )
        assert.equal(
            manifest.pullRequest,
            null,
            'recovery artifact cannot claim a pull request',
        )
    }

    const bytes = fs.readFileSync(path.join(directory, expectedInstaller))
    assert.equal(
        manifest.installer.size,
        bytes.byteLength,
        'installer size differs from manifest',
    )
    assert.equal(
        manifest.installer.sha256,
        crypto.createHash('sha256').update(bytes).digest('hex'),
        'installer SHA-256 differs from manifest',
    )
    return manifest
}

function main() {
    const [tag, artifactDirectory, expectedSourceHeadSha, expectedPullRequest] =
        process.argv.slice(2)
    assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
    assert.ok(artifactDirectory, 'artifact directory is required')
    const version = require('../../package.json').version
    execFileSync(process.execPath, ['tools/checks/check-version.cjs', tag], {
        stdio: 'inherit',
    })
    const revision = (...args) =>
        execFileSync('git', ['rev-parse', ...args], { encoding: 'utf8' }).trim()
    const manifest = verifyInstallerArtifact({
        tag,
        version,
        tagTreeSha: revision(`${tag}^{tree}`),
        artifactDirectory,
        expectedSourceHeadSha,
        expectedPullRequest,
        tagCommitSha: revision(`${tag}^{commit}`),
    })
    console.log(
        `Verified ${manifest.installer.name} against ${tag} (tree ${manifest.testedTreeSha}, sha256 ${manifest.installer.sha256})`,
    )
}

if (require.main === module) main()

module.exports = { verifyInstallerArtifact }
