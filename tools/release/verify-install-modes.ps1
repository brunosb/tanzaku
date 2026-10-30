$ErrorActionPreference = 'Stop'

if ($env:TAURI_INSTALLER_CI_SMOKE -ne '1' -or $env:CI -ne 'true' -or -not $env:RUNNER_TEMP) {
    throw 'This installer integration test is restricted to an isolated GitHub Actions runner.'
}

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$installPath = [IO.Path]::GetFullPath((Join-Path $runnerTemp 'Tanzaku upgrade fixture'))
if (-not $installPath.StartsWith($runnerTemp + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Upgrade fixture must stay inside RUNNER_TEMP.'
}

$package = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
$candidateVersion = [Version]$package.version
$candidatePath = Join-Path $workspace "src-tauri/target/release/bundle/nsis/Tanzaku_$($package.version)_x64-setup.exe"
$defaultPath = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Tanzaku'))
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Tanzaku'
$installKey = 'HKCU:\Software\tanzaku\Tanzaku'

if (-not (Test-Path -LiteralPath $candidatePath)) { throw "Current installer not found: $candidatePath" }
if (Test-Path -LiteralPath $uninstallKey) { throw 'CI runner unexpectedly has a registered Tanzaku installation.' }
if (Test-Path -LiteralPath $defaultPath) { throw 'CI runner unexpectedly has the default Tanzaku folder.' }
if (Test-Path -LiteralPath $installPath) { throw 'Upgrade fixture path already exists.' }

function Start-Installer([string]$Path, [string]$Arguments, [string]$WorkingDirectory) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode): $Path" }
}

function Get-RegisteredInstall {
    if (-not (Test-Path -LiteralPath $uninstallKey)) { throw 'Tanzaku uninstall registration is missing.' }
    Get-ItemProperty -LiteralPath $uninstallKey
}

function Remove-TestInstall([string]$Path) {
    $uninstaller = Join-Path $Path 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WorkingDirectory $Path -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Test uninstaller failed with exit code $($process.ExitCode)." }
    }
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
}

$oldInstallerPath = Join-Path $runnerTemp 'Tanzaku_1.0.0_x64-setup.exe'
$defaultInstalled = $false
$upgradeInstalled = $false
try {
    # Exercise the same $INSTDIR shown by the NSIS directory page, from the
    # repository working directory and without an explicit /D override.
    Start-Installer $candidatePath '/S' $workspace
    $defaultInstalled = $true
    $registration = Get-RegisteredInstall
    $registeredPath = [IO.Path]::GetFullPath(([string]$registration.InstallLocation).Trim('"').TrimEnd('\'))
    if (-not $registeredPath.Equals($defaultPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Fresh install used '$registeredPath'; expected '$defaultPath'."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $defaultPath 'tanzaku-tauri-experiment.exe'))) {
        throw 'Fresh install did not place the app executable in the default folder.'
    }
    Remove-TestInstall $defaultPath
    $defaultInstalled = $false

    $checksumFile = Join-Path $runnerTemp 'Tanzaku_1.0.0_SHA256SUMS.txt'
    Invoke-WebRequest -Uri 'https://github.com/brunosb/tanzaku/releases/download/v1.0.0/SHA256SUMS.txt' -OutFile $checksumFile -UseBasicParsing
    $checksumEntry = Get-Content -LiteralPath $checksumFile | Where-Object { $_ -match '^([0-9a-f]{64})\s+Tanzaku_1\.0\.0_x64-setup\.exe$' } | Select-Object -First 1
    if (-not $checksumEntry) { throw 'The v1.0.0 release checksum file does not contain its installer.' }
    $expectedHash = [regex]::Match($checksumEntry, '^([0-9a-f]{64})\s+').Groups[1].Value
    Invoke-WebRequest -Uri 'https://github.com/brunosb/tanzaku/releases/download/v1.0.0/Tanzaku_1.0.0_x64-setup.exe' -OutFile $oldInstallerPath -UseBasicParsing
    $actualHash = (Get-FileHash -LiteralPath $oldInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw 'Downloaded v1.0.0 installer does not match its published SHA-256 checksum.' }

    # Start from the real public v1.0.0 installer at a custom install location.
    Start-Installer $oldInstallerPath ('/S /D=' + $installPath) $workspace
    $upgradeInstalled = $true
    $oldRegistration = Get-RegisteredInstall
    $oldPath = [IO.Path]::GetFullPath(([string]$oldRegistration.InstallLocation).Trim('"').TrimEnd('\'))
    if (-not $oldPath.Equals($installPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Legacy fixture installed at '$oldPath'; expected '$installPath'."
    }

    $sentinel = Join-Path $installPath 'preserve-on-update.txt'
    [IO.File]::WriteAllText($sentinel, 'This file proves the update did not uninstall the existing installation.')

    # Before the 1.0.1 release PR exists, report the fixture as an older release
    # so PR CI exercises the same upgrade branch. Release CI uses the real 1.0.0.
    if ($candidateVersion -le [Version]'1.0.0') {
        Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value '0.9.0'
    }

    # If the new installer tries to run the old uninstaller, it exits with a
    # distinctive failure code and makes the CI check fail.
    $guardCommand = '"' + (Join-Path $env:WINDIR 'System32/cmd.exe') + '" /c exit 73'
    Set-ItemProperty -LiteralPath $uninstallKey -Name UninstallString -Value $guardCommand
    Start-Installer $candidatePath '/S' $workspace

    $newRegistration = Get-RegisteredInstall
    $newPath = [IO.Path]::GetFullPath(([string]$newRegistration.InstallLocation).Trim('"').TrimEnd('\'))
    if (-not $newPath.Equals($installPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Update moved the existing installation to '$newPath' instead of preserving '$installPath'."
    }
    if ($newRegistration.DisplayVersion -ne $package.version) {
        throw "Update registered version '$($newRegistration.DisplayVersion)'; expected '$($package.version)'."
    }
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Update removed a file from the existing installation.' }
    if ([string]$newRegistration.UninstallString -eq $guardCommand) {
        throw 'Update did not replace the old uninstall registration.'
    }

    $updatedApp = Join-Path $installPath 'tanzaku-tauri-experiment.exe'
    if (-not (Test-Path -LiteralPath $updatedApp)) { throw 'Updated app executable is missing.' }
    $updatedFileVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($updatedApp).ProductVersion
    if (-not $updatedFileVersion.StartsWith($package.version, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Updated executable reports '$updatedFileVersion'; expected '$($package.version)'."
    }

    Remove-TestInstall $installPath
    $upgradeInstalled = $false
    Write-Host "Verified clean default install and in-place update to $($package.version)."
} finally {
    if ($defaultInstalled) {
        if (Test-Path -LiteralPath $defaultPath) { Remove-TestInstall $defaultPath }
        elseif (Test-Path -LiteralPath $uninstallKey) { Remove-Item -LiteralPath $uninstallKey -Recurse -Force }
    }
    if ($upgradeInstalled -and (Test-Path -LiteralPath $installPath)) {
        Remove-TestInstall $installPath
    }
    if (Test-Path -LiteralPath $oldInstallerPath) { Remove-Item -LiteralPath $oldInstallerPath -Force }
}
