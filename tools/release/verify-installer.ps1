$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$packageInfo = Get-Content -LiteralPath (Join-Path $releaseRoot 'package.json') -Raw | ConvertFrom-Json
$bundlePath = Join-Path $releaseRoot 'src-tauri/target/release/bundle/nsis'
$installers = @(Get-ChildItem -LiteralPath $bundlePath -Filter "*_$($packageInfo.version)_x64-setup.exe")
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows x64 installer for the current version.' }
$installPath = [IO.Path]::GetFullPath((Join-Path $releaseRoot 'src-tauri/target/installer-smoke'))
if (-not $installPath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer smoke path must remain inside the workspace.' }
$installerProcess = Start-Process -FilePath $installers[0].FullName -ArgumentList ('/S /D=' + $installPath) -WindowStyle Hidden -Wait -PassThru
if ($installerProcess.ExitCode -ne 0) { throw "Installer exited with $($installerProcess.ExitCode)." }
$appExecutable = Join-Path $installPath 'tanzaku-tauri-experiment.exe'
if (-not (Test-Path -LiteralPath $appExecutable)) { throw 'Installed application executable is missing.' }
Push-Location $releaseRoot
try {
    node tools/smoke/smoke-tauri.cjs --fixture $appExecutable
    if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed.' }
} finally { Pop-Location }
