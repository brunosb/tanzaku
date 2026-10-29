const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const cli = path.join(root, 'node_modules/@commitlint/cli/cli.js')
const prefix = 'fix: '
const cases = [
    ['1000-character header', prefix + 'a'.repeat(1000 - prefix.length), true],
    ['1001-character header', prefix + 'a'.repeat(1001 - prefix.length), false],
    ['missing type', 'corrigir paginação', false],
    ['missing subject', 'fix: ', false],
    [
        'Portuguese subject',
        'fix(biblioteca): Corrigir paginação com acentos',
        true,
    ],
    ['English subject', 'feat(playback): Add optional auto advance', true],
    [
        'long body and breaking footer',
        `feat!: explain an incompatible change\n\n${'Detailed explanation. '.repeat(200)}\n\nBREAKING CHANGE: ${'Migration instructions. '.repeat(200)}`,
        true,
    ],
]

for (const [name, message, expected] of cases) {
    const result = spawnSync(
        process.execPath,
        [cli, '--config', 'commitlint.config.cjs'],
        {
            cwd: root,
            input: `${message}\n`,
            encoding: 'utf8',
            windowsHide: true,
        },
    )
    if (result.error) throw result.error
    assert.equal(
        result.status === 0,
        expected,
        `${name}: ${result.stdout}${result.stderr}`,
    )
}
console.log(
    `Commitlint accepted/rejected all ${cases.length} message scenarios as expected`,
)
