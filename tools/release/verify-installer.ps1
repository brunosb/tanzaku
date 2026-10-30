$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$packageInfo = Get-Content -LiteralPath (Join-Path $releaseRoot 'package.json') -Raw | ConvertFrom-Json
$bundlePath = Join-Path $releaseRoot 'src-tauri/target/release/bundle/nsis'
$installers = @(Get-ChildItem -LiteralPath $bundlePath -Filter "*_$($packageInfo.version)_x64-setup.exe")
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows x64 installer for the current version.' }
$installPath = [IO.Path]::GetFullPath((Join-Path $releaseRoot ('src-tauri/target/installer smoke ' + [char]0x00e1)))
if (-not $installPath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer smoke path must remain inside the workspace.' }
# Preserve a developer's existing installation registration and shortcuts.
# CI uses a disposable Windows user, but the same command is also run locally.
$uninstallKey = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/Tanzaku'
$installLocationKey = 'HKCU:/Software/tanzaku/Tanzaku'
$registryBackup = Join-Path $releaseRoot 'src-tauri/target/installer-registration.reg'
$installLocationBackup = Join-Path $releaseRoot 'src-tauri/target/installer-location.reg'
$hadRegistration = Test-Path -LiteralPath $uninstallKey
$hadInstallLocation = Test-Path -LiteralPath $installLocationKey
if ($hadRegistration) {
    reg.exe export 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Tanzaku' $registryBackup /y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not back up the existing installation registration.' }
}
if ($hadInstallLocation) {
    reg.exe export 'HKCU\Software\tanzaku\Tanzaku' $installLocationBackup /y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not back up the existing installation location.' }
}
$shortcutRoots = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$shortcuts = @{}
function Get-ContentSha256($file) {
    $stream = [IO.File]::OpenRead($file)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)) } finally { $sha.Dispose(); $stream.Dispose() }
}
foreach ($shortcutRoot in $shortcutRoots) {
    Get-ChildItem -LiteralPath $shortcutRoot -Filter 'Tanzaku.lnk' -File -Recurse | ForEach-Object { $shortcuts[$_.FullName] = [IO.File]::ReadAllBytes($_.FullName) }
}
try {
    $installerProcess = Start-Process -FilePath $installers[0].FullName -ArgumentList ('/S /D=' + $installPath) -WindowStyle Hidden -Wait -PassThru
    if ($installerProcess.ExitCode -ne 0) { throw "Installer exited with $($installerProcess.ExitCode)." }
    $appExecutable = Join-Path $installPath 'tanzaku-tauri-experiment.exe'
    if (-not (Test-Path -LiteralPath $appExecutable)) { throw 'Installed application executable is missing.' }
    node tools/release/audit-runtime.cjs $installPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Installed runtime dependency audit failed.' }
    Push-Location $releaseRoot
    try {
        node tools/smoke/smoke-tauri.cjs --fixture $appExecutable
        if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed.' }
    } finally { Pop-Location }
    # Reinstall over the smoke installation and preserve its real isolated library.
    $smokeResult = Get-Content -Raw -LiteralPath (Join-Path $releaseRoot 'src-tauri/target/smoke/result.json') | ConvertFrom-Json
    $library = Join-Path $smokeResult.isolatedData 'library.json'
    $libraryHash = Get-ContentSha256 $library
    Set-Content -LiteralPath (Join-Path $installPath 'bin/deno.exe') -Value 'obsolete Tanzaku component'
    $upgradeProcess = Start-Process -FilePath $installers[0].FullName -ArgumentList ('/S /D=' + $installPath) -WindowStyle Hidden -Wait -PassThru
    if ($upgradeProcess.ExitCode -ne 0) { throw "Upgrade exited with $($upgradeProcess.ExitCode)." }
    if ((Get-ContentSha256 $library) -ne $libraryHash) { throw 'Upgrade changed the library.' }
    if (Test-Path -LiteralPath (Join-Path $installPath 'bin/deno.exe')) { throw 'Upgrade did not remove the obsolete Deno binary.' }
    node tools/release/audit-runtime.cjs $installPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Upgraded runtime dependency audit failed.' }
} finally {
    if ($hadRegistration) {
        reg.exe import $registryBackup | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restore the previous installation registration.' }
    } elseif (Test-Path -LiteralPath $uninstallKey) {
        Remove-Item -LiteralPath 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/Tanzaku' -Recurse
    }
    if ($hadInstallLocation) {
        reg.exe import $installLocationBackup | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restore the previous installation location.' }
    } elseif (Test-Path -LiteralPath $installLocationKey) {
        Remove-Item -LiteralPath $installLocationKey -Recurse
    }
    foreach ($shortcutRoot in $shortcutRoots) {
        Get-ChildItem -LiteralPath $shortcutRoot -Filter 'Tanzaku.lnk' -File -Recurse | ForEach-Object {
            if ($shortcuts.ContainsKey($_.FullName)) { [IO.File]::WriteAllBytes($_.FullName, $shortcuts[$_.FullName]) }
            else { Remove-Item -LiteralPath $_.FullName }
        }
    }
}
