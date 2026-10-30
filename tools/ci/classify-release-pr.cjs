const assert = require('node:assert/strict')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const allowedFiles = new Set([
    '.release-please-manifest.json',
    'CHANGELOG.md',
    'package-lock.json',
    'package.json',
    'src-tauri/Cargo.lock',
    'src-tauri/Cargo.toml',
    'src-tauri/tauri.conf.json',
])

function classifyReleasePullRequest({ event, repository, changedFiles }) {
    const pullRequest = event?.pull_request
    if (
        event?.action === undefined ||
        !pullRequest ||
        pullRequest.user?.login !== 'github-actions[bot]' ||
        pullRequest.head?.repo?.full_name !== repository ||
        pullRequest.head?.ref !==
            'release-please--branches--main--components--tanzaku'
    ) {
        return false
    }

    assert.match(
        pullRequest.title ?? '',
        /^chore\(main\): release \d+\.\d+\.\d+(?:-[\w.-]+)?$/,
        'trusted Release Please PR must have its expected release title',
    )
    assert.ok(changedFiles.length > 0, 'release PR must change version files')
    const unexpected = changedFiles.filter((file) => !allowedFiles.has(file))
    assert.deepEqual(
        unexpected,
        [],
        `Release Please PR contains out-of-scope files: ${unexpected.join(', ')}`,
    )
    return true
}

function main() {
    const event = JSON.parse(
        fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'),
    )
    const baseSha = process.env.BASE_SHA
    const headSha = process.env.HEAD_SHA
    assert.match(baseSha ?? '', /^[0-9a-f]{40}$/i)
    assert.match(headSha ?? '', /^[0-9a-f]{40}$/i)
    const changedFiles = execFileSync(
        'git',
        [
            'diff',
            '--name-only',
            '--diff-filter=ACDMRTUXB',
            `${baseSha}...${headSha}`,
        ],
        { encoding: 'utf8' },
    )
        .split(/\r?\n/)
        .filter(Boolean)
    const isReleasePr = classifyReleasePullRequest({
        event,
        repository: process.env.GITHUB_REPOSITORY,
        changedFiles,
    })
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_pr=${isReleasePr}\n`)
    console.log(
        isReleasePr
            ? 'Trusted Release Please PR; changed files are within the version allowlist.'
            : 'Regular PR; full Node and Windows Rust validation will run.',
    )
}

if (require.main === module) main()

module.exports = { allowedFiles, classifyReleasePullRequest }
