const fs = require('node:fs')
const crypto = require('node:crypto')

function inspect(bytes) {
    if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ')
        throw new Error('Not a PE executable (possibly a Git LFS pointer)')
    const pe = bytes.readUInt32LE(60)
    if (
        pe + 24 > bytes.length ||
        bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0'
    )
        throw new Error('Invalid PE header')
    if (bytes.readUInt16LE(pe + 4) !== 0x8664)
        throw new Error('Expected Windows x64 architecture')
    if (bytes.includes(Buffer.from('uv trampoline')))
        throw new Error('uv trampoline is not a standalone executable')
    const optional = pe + 24
    if (bytes.readUInt16LE(optional) !== 0x20b)
        throw new Error('Expected PE32+')
    const directory = optional + 112
    const directoryCount = bytes.readUInt32LE(optional + 108)
    const sections = []
    const start = optional + bytes.readUInt16LE(pe + 20)
    for (let i = 0; i < bytes.readUInt16LE(pe + 6); i++) {
        const p = start + i * 40
        sections.push({
            rva: bytes.readUInt32LE(p + 12),
            size: Math.max(
                bytes.readUInt32LE(p + 8),
                bytes.readUInt32LE(p + 16),
            ),
            raw: bytes.readUInt32LE(p + 20),
        })
    }
    function offset(rva) {
        const section = sections.find(
            (s) => rva >= s.rva && rva < s.rva + s.size,
        )
        if (!section) throw new Error(`Invalid PE address: ${rva}`)
        return rva - section.rva + section.raw
    }
    function name(rva) {
        const p = offset(rva)
        const end = bytes.indexOf(0, p)
        if (end < p) throw new Error('Unterminated PE import')
        return bytes.toString('ascii', p, end).toLowerCase()
    }
    const imports = []
    for (const [index, stride, field] of [
        [1, 20, 12],
        [13, 32, 4],
    ]) {
        if (directoryCount <= index) continue
        const rva = bytes.readUInt32LE(directory + index * 8)
        if (!rva) continue
        let p = offset(rva)
        for (let i = 0; i < 4096; i++, p += stride) {
            let address = bytes.readUInt32LE(p + field)
            if (!address) break
            if (index === 13 && !(bytes.readUInt32LE(p) & 1))
                address -= Number(bytes.readBigUInt64LE(optional + 24))
            imports.push(name(address))
            if (i === 4095) throw new Error('PE import limit exceeded')
        }
    }
    return { machine: 'x64', imports: [...new Set(imports)] }
}
function verify(file, sha256) {
    const bytes = fs.readFileSync(file)
    const actual = crypto.createHash('sha256').update(bytes).digest('hex')
    if (actual !== sha256) throw new Error(`SHA-256 mismatch: ${file}`)
    if (/\.(exe|dll)$/i.test(file)) inspect(bytes)
    return actual
}
module.exports = { inspect, verify }
