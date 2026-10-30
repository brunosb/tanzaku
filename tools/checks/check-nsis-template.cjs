const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const config = JSON.parse(
    fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
)
const templatePath = config.bundle.windows.nsis.template
assert.equal(templatePath, 'nsis/installer.nsi')
assert.equal(config.bundle.windows.nsis.installMode, 'currentUser')

const template = fs.readFileSync(
    path.join(root, 'src-tauri', templatePath),
    'utf8',
)
assert.match(template, /tauri-v2\.12\.3/)
assert.match(
    template,
    /!define DEFAULT_INSTALL_DIR "\$LOCALAPPDATA\\\$\{PRODUCTNAME\}"/,
)
assert.match(template, /InstallDir "\$\{DEFAULT_INSTALL_DIR\}"/)
assert.match(template, /\$INSTDIR == "\$\{DEFAULT_INSTALL_DIR\}"/)
assert.doesNotMatch(template, /PLACEHOLDER_INSTALL_DIR|InstallDir "placeholder/)

const page = template.match(/Function PageReinstall([\s\S]*?)FunctionEnd/)
assert.ok(page, 'NSIS reinstall page must exist')
const upgradeSkip = page[1].match(
    /SemverCompare "\$\{VERSION\}" \$R0[\s\S]*?Pop \$R0([\s\S]*?); Reinstalling the same version/,
)
assert.ok(
    upgradeSkip,
    'upgrade handling must run after semantic version detection',
)
assert.match(upgradeSkip[1], /\$R0 = 1/)
assert.match(upgradeSkip[1], /\$WixMode = 0/)
assert.match(upgradeSkip[1], /Abort/)
const pageLeave = template.match(
    /Function PageLeaveReinstall([\s\S]*?)FunctionEnd/,
)
assert.ok(pageLeave, 'NSIS reinstall page leave handler must exist')
assert.match(
    pageLeave[1],
    /\$\{If\} \$WixMode = 1[\s\S]*?Goto reinst_uninstall/,
)

console.log(
    'NSIS template uses an absolute per-user path and skips uninstall on upgrades.',
)
