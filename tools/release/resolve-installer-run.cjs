const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

const tag = process.argv[2]
assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
const repository = process.env.GITHUB_REPOSITORY
assert.match(repository ?? '', /^[^/]+\/[^/]+$/)
const tagCommit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], {
    encoding: 'utf8',
}).trim()
const gh = (endpoint) =>
    JSON.parse(
        execFileSync('gh', ['api', endpoint], {
            encoding: 'utf8',
            env: process.env,
        }),
    )

const prs = gh(`repos/${repository}/commits/${tagCommit}/pulls`)
const matchingPrs = prs.filter(
    (pr) =>
        pr.base?.ref === 'main' &&
        pr.merged_at &&
        pr.user?.login === 'github-actions[bot]' &&
        pr.head?.repo?.full_name === repository &&
        pr.head?.ref?.startsWith('release-please--') &&
        pr.title === `chore(main): release ${tag.slice(1)}`,
)
assert.equal(
    matchingPrs.length,
    1,
    `expected exactly one merged Release Please PR associated with ${tag}`,
)
const pr = matchingPrs[0]
const artifactName = `tanzaku-release-installer-${pr.head.sha}`
const runs = gh(
    `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${pr.head.sha}&event=pull_request&per_page=100`,
).workflow_runs
assert.ok(Array.isArray(runs), 'workflow run query returned no run list')

const candidates = []
for (const run of runs) {
    if (
        run.status !== 'completed' ||
        run.conclusion !== 'success' ||
        run.head_sha !== pr.head.sha ||
        run.head_branch !== pr.head.ref
    ) {
        continue
    }
    const artifacts = gh(
        `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
    ).artifacts
    for (const artifact of artifacts ?? []) {
        if (artifact.name === artifactName && !artifact.expired) {
            candidates.push({ run, artifact })
        }
    }
}
assert.ok(
    candidates.length > 0,
    `no successful, unexpired installer artifact found for PR #${pr.number} (${pr.head.sha})`,
)
candidates.sort(
    (left, right) =>
        Date.parse(right.run.created_at) - Date.parse(left.run.created_at),
)
const selected = candidates[0]
const outputs = [
    ['run_id', selected.run.id],
    ['artifact_id', selected.artifact.id],
    ['source_head_sha', pr.head.sha],
    ['pull_request', pr.number],
]
assert.ok(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required')
fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    outputs.map(([name, value]) => `${name}=${value}`).join('\n') + '\n',
)
console.log(
    `Selected installer artifact ${selected.artifact.id} from run ${selected.run.id}, PR #${pr.number}`,
)
