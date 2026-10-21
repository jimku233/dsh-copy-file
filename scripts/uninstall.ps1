<#
.SYNOPSIS
    Remove dsh-copy-file from a dsh profile and restore the manifest exactly.

.DESCRIPTION
    Restores dsh.profile.bundles from the record written by install.ps1, deletes
    the package from the profile's node_modules, and removes the record
    directory. Nothing inside the dsh installation is touched, so there is no
    build artifact to roll back.

.PARAMETER Profile
    Profile name. Default 'web'.

.PARAMETER DshHome
    Harness home override. Defaults to $env:DSH_HOME, else ~/.dsh.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile = 'web',
    [string]$DshHome
)

$ErrorActionPreference = 'Stop'
$PackageName = 'dsh-copy-file'

function Write-Step([string]$Text) { Write-Host "  $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  OK  $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "  !!  $Text" -ForegroundColor Yellow }

function Resolve-DshHome {
    if ($DshHome -and $DshHome.Trim() -ne '') { return (Resolve-Path -LiteralPath $DshHome).Path }
    if ($env:DSH_HOME -and $env:DSH_HOME.Trim() -ne '') { return $env:DSH_HOME }
    return (Join-Path $env:USERPROFILE '.dsh')
}

function Read-JsonFile([string]$Path) {
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return ($raw | ConvertFrom-Json)
}

function Write-JsonFile([string]$Path, $Value) {
    $json = ($Value | ConvertTo-Json -Depth 32)
    [System.IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "`ndsh-copy-file uninstaller" -ForegroundColor White

$dshHomeDir = Resolve-DshHome
$profileDir = Join-Path (Join-Path $dshHomeDir 'profiles') $Profile
$manifestPath = Join-Path $profileDir 'package.json'
$stateDir = Join-Path $profileDir '.dsh-copy-file'
$statePath = Join-Path $stateDir 'install.json'
$targetDir = Join-Path (Join-Path $profileDir 'node_modules') $PackageName

if (-not (Test-Path -LiteralPath $profileDir)) { throw "Profile '$Profile' was not found at $profileDir." }
Write-Step "profile: $profileDir"

# ── restore the bundle list ──────────────────────────────────────────────────
$manifest = Read-JsonFile $manifestPath
$bundles = @()
if ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles) { $bundles = @($manifest.dsh.profile.bundles) }

if (Test-Path -LiteralPath $statePath) {
    $state = Read-JsonFile $statePath
    $before = @($state.bundlesBefore)
    if ($before.Count -gt 0 -or $bundles.Contains($PackageName)) {
        $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $before -Force
        Write-JsonFile $manifestPath $manifest
        Write-Ok "restored the original bundle list ($($before.Count) entries)"
    }
} else {
    $kept = @($bundles | Where-Object { $_ -ne $PackageName })
    if ($kept.Count -ne $bundles.Count) {
        $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $kept -Force
        Write-JsonFile $manifestPath $manifest
        Write-Ok "removed '$PackageName' from the bundle list"
    } else {
        Write-Step 'the bundle list did not contain the package'
    }
}

# ── remove the package and the record ───────────────────────────────────────
if (Test-Path -LiteralPath $targetDir) {
    Remove-Item -LiteralPath $targetDir -Recurse -Force
    Write-Ok "removed $targetDir"
} else {
    Write-Step 'package directory was already absent'
}
if (Test-Path -LiteralPath $stateDir) {
    Remove-Item -LiteralPath $stateDir -Recurse -Force
    Write-Ok 'removed the install record'
}

# ── no background helper, no autostart ──────────────────────────────────────
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'dsh-copy-file-helper.lnk'
if (Test-Path -LiteralPath $shortcut) {
    Remove-Item -LiteralPath $shortcut -Force
    Write-Ok 'removed the optional autostart shortcut'
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'dsh-copy-file' -and $_.CommandLine -match 'helper' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Ok "stopped helper pid $($_.ProcessId)" }

Write-Host ""
Write-Host 'Uninstalled. Refresh the Web GUI; the card menu returns to its shipped state.' -ForegroundColor Green
