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
    const expectedInstaller = `Tanzaku_${version}_x64-setup.exe`
    const files = []
    const visit = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name)
            if (entry.isDirectory()) visit(fullPath)
            else files.push(fullPath)
        }
    }
    visit(directory)
    const manifests = files.filter(
        (file) => path.basename(file) === 'artifact-manifest.json',
    )
    const installers = files.filter(
        (file) => path.basename(file) === expectedInstaller,
    )
    assert.equal(
        files.length,
        2,
        `artifact must contain only installer and manifest; found: ${
            files.map((file) => path.relative(directory, file)).join(', ') ||
            '(none)'
        }`,
    )
    assert.equal(manifests.length, 1, 'artifact manifest must be present once')
    assert.equal(
        installers.length,
        1,
        'versioned x64 installer must be present once',
    )
    assert.equal(
        path.dirname(manifests[0]),
        path.dirname(installers[0]),
        'installer and manifest must be in the same artifact directory',
    )

    const manifest = JSON.parse(fs.readFileSync(manifests[0], 'utf8'))
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

    const bytes = fs.readFileSync(installers[0])
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
