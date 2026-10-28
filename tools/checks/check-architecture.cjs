const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = path.join(root, 'src')
const slash = (value) => value.split(path.sep).join('/')
const walk = (dir) =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
            entry.isDirectory()
                ? walk(path.join(dir, entry.name))
                : [path.join(dir, entry.name)],
        )
const graph = new Map(),
    errors = []
for (const file of walk(source).filter((file) => /\.tsx?$/.test(file))) {
    const from = slash(path.relative(source, file)),
        text = fs.readFileSync(file, 'utf8')
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const edges = []
    for (const statement of ast.statements) {
        if (
            !(
                ts.isImportDeclaration(statement) ||
                ts.isExportDeclaration(statement)
            ) ||
            !statement.moduleSpecifier
        )
            continue
        const spec = statement.moduleSpecifier.text
        if (!(spec.startsWith('.') || spec.startsWith('@/'))) continue
        const base = spec.startsWith('@/')
            ? path.join(source, spec.slice(2))
            : path.resolve(path.dirname(file), spec)
        const target = [
            base,
            base + '.ts',
            base + '.tsx',
            path.join(base, 'index.ts'),
            path.join(base, 'index.tsx'),
            base.replace(/\.js$/, '.ts'),
        ].find(
            (candidate) =>
                fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
        )
        if (!target) {
            errors.push(from + ': unresolved import ' + spec)
            continue
        }
        const to = slash(path.relative(source, target))
        if (from.startsWith('shared/') && /^(app|features)\//.test(to))
            errors.push(from + ' imports ' + to)
        if (from.startsWith('features/') && to.startsWith('app/'))
            errors.push(from + ' imports ' + to)
        if (/\.tsx?$/.test(target)) edges.push(to)
    }
    if (from !== 'shared/api/tauri-bridge.ts' && /window\.__TAURI__/.test(text))
        errors.push(from + ': native global outside bridge')
    graph.set(from, edges)
}
const visiting = new Set(),
    visited = new Set()
function visit(file, chain = []) {
    if (visiting.has(file)) {
        errors.push('Import cycle: ' + [...chain, file].join(' -> '))
        return
    }
    if (visited.has(file)) return
    visiting.add(file)
    for (const next of graph.get(file) ?? []) visit(next, [...chain, file])
    visiting.delete(file)
    visited.add(file)
}
for (const file of graph.keys()) visit(file)
if (errors.length) {
    console.error([...new Set(errors)].join('\n'))
    process.exitCode = 1
} else
    console.log(
        'Architecture boundaries and imports verified (' +
            graph.size +
            ' modules).',
    )
