<#
.SYNOPSIS
    Remove dsh-copy-file from a dsh profile.

.DESCRIPTION
    Drops this package's own entry from dsh.profile.bundles (bundles added later
    survive), deletes the package from the profile's node_modules, and removes
    the record directory. Nothing inside the dsh installation is touched, so
    there is no build artifact to roll back.

.PARAMETER Profile
    Profile name. Omitted: uses `desktop` when it lists the web app bundle, else `web`.

.PARAMETER DshHome
    Harness home override. Defaults to $env:DSH_HOME, else ~/.dsh.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile,
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

function Get-ProfileBundles($Manifest) {
    if ($Manifest.dsh -and $Manifest.dsh.profile -and $Manifest.dsh.profile.bundles) {
        return @($Manifest.dsh.profile.bundles)
    }
    return @()
}

function Resolve-ProfileName([string]$HarnessHome) {
    if ($Profile -and $Profile.Trim() -ne '') { return $Profile.Trim() }
    $desktopManifest = Join-Path (Join-Path (Join-Path $HarnessHome 'profiles') 'desktop') 'package.json'
    if (Test-Path -LiteralPath $desktopManifest) {
        try {
            if ((Get-ProfileBundles (Read-JsonFile $desktopManifest)) -contains '@deepseek-ai/dsh-web-app') { return 'desktop' }
        } catch {
            # fall through to web
        }
    }
    return 'web'
}

Write-Host "`ndsh-copy-file uninstaller" -ForegroundColor White

$dshHomeDir = Resolve-DshHome
$profileName = Resolve-ProfileName $dshHomeDir
$profileDir = Join-Path (Join-Path $dshHomeDir 'profiles') $profileName
$manifestPath = Join-Path $profileDir 'package.json'
$stateDir = Join-Path $profileDir '.dsh-copy-file'
$statePath = Join-Path $stateDir 'install.json'
$targetDir = Join-Path (Join-Path $profileDir 'node_modules') $PackageName

if (-not (Test-Path -LiteralPath $profileDir)) { throw "Profile '$profileName' was not found at $profileDir." }
Write-Step "profile: $profileName ($profileDir)"

# ── drop our own bundle entry ────────────────────────────────────────────────
$manifest = Read-JsonFile $manifestPath
$bundles = Get-ProfileBundles $manifest
$before = @()
if (Test-Path -LiteralPath $statePath) {
    try { $before = @((Read-JsonFile $statePath).bundlesBefore) } catch { $before = @() }
}
$kept = @($bundles | Where-Object { $_ -ne $PackageName })
if ($kept.Count -ne $bundles.Count) {
    $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $kept -Force
    Write-JsonFile $manifestPath $manifest
    Write-Ok ("removed '{0}'; {1} bundle(s) kept (was {2} before install)" -f $PackageName, $kept.Count, $before.Count)
} else {
    Write-Step 'the bundle list did not contain the package'
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
