const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { inspect, verify } = require('../release/pe.cjs')
const { audit, auditImports } = require('../release/audit-runtime.cjs')

function pe(machine = 0x8664, dependency = 'kernel32.dll', delayed = false) {
    const b = Buffer.alloc(1024)
    b.write('MZ')
    b.writeUInt32LE(64, 60)
    b.write('PE\0\0', 64)
    b.writeUInt16LE(machine, 68)
    b.writeUInt16LE(1, 70)
    b.writeUInt16LE(240, 84)
    const opt = 88
    b.writeUInt16LE(0x20b, opt)
    b.writeUInt32LE(16, opt + 108)
    const section = opt + 240
    b.writeUInt32LE(512, section + 8)
    b.writeUInt32LE(4096, section + 12)
    b.writeUInt32LE(512, section + 16)
    b.writeUInt32LE(512, section + 20)
    b.writeUInt32LE(4096, opt + 112 + (delayed ? 13 : 1) * 8)
    if (delayed) {
        b.writeUInt32LE(1, 512)
        b.writeUInt32LE(4224, 516)
    } else b.writeUInt32LE(4224, 524)
    b.write(dependency, 640)
    return b
}
test('PE audit rejects launchers, LFS pointers, wrong architecture and malformed headers', () => {
    assert.throws(
        () =>
            inspect(Buffer.from('version https://git-lfs.github.com/spec/v1')),
        /PE/,
    )
    assert.throws(() => inspect(pe(0x14c)), /x64/)
    assert.throws(
        () => inspect(Buffer.concat([pe(), Buffer.from('uv trampoline')])),
        /trampoline/,
    )
    const broken = pe()
    broken.writeUInt32LE(0xffffffff, 60)
    assert.throws(() => inspect(broken), /header/)
})
test('PE audit reads both normal and delayed imports', () => {
    assert.deepEqual(inspect(pe()).imports, ['kernel32.dll'])
    assert.deepEqual(inspect(pe(0x8664, 'vcruntime140.dll', true)).imports, [
        'vcruntime140.dll',
    ])
})
test('dependency audit resolves packaged DLLs transitively and rejects developer-installed runtimes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanzaku-imports-'))
    try {
        const exe = path.join(dir, 'app.exe'),
            runtime = path.join(dir, 'vcruntime140.dll')
        fs.writeFileSync(exe, pe(0x8664, 'vcruntime140.dll'))
        assert.throws(() => auditImports(dir), /unpackaged vcruntime140\.dll/)
        fs.writeFileSync(runtime, pe(0x8664, 'required-package.dll', true))
        assert.throws(
            () => auditImports(dir),
            /unpackaged required-package\.dll/,
        )
        fs.writeFileSync(path.join(dir, 'required-package.dll'), pe())
        assert.equal(auditImports(dir).length, 3)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})
test('hash verification rejects altered and absent resources', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanzaku-runtime-'))
    try {
        const file = path.join(dir, 'tool.exe'),
            bytes = pe()
        fs.writeFileSync(file, bytes)
        const hash = crypto.createHash('sha256').update(bytes).digest('hex')
        verify(file, hash)
        fs.appendFileSync(file, 'changed')
        assert.throws(() => verify(file, hash), /SHA-256/)
        assert.throws(
            () => verify(path.join(dir, 'missing.exe'), hash),
            /ENOENT/,
        )
        assert.throws(() => audit(dir), /ENOENT/)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})
