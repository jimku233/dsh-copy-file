<#
.SYNOPSIS
    Install dsh-copy-file into one dsh profile (default: web).

.DESCRIPTION
    Idempotent. Copies this package into the profile's node_modules, appends it
    to dsh.profile.bundles, and records the original manifest so uninstall can
    restore it exactly. Never edits a file inside the dsh installation: the
    feature is a bundle row plus a package the profile owns.

    Node 22.19+ and the dsh CLI are required. Run it as the user who runs dsh.

.PARAMETER Profile
    Profile name to install into. Default 'web'.

.PARAMETER DshHome
    Harness home override. Defaults to $env:DSH_HOME, else ~/.dsh.

.PARAMETER Force
    Reinstall even when the same version is already present.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/install.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile = 'web',
    [string]$DshHome,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
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
    # No BOM: dsh parses profile manifests with JSON.parse.
    [System.IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "`ndsh-copy-file installer" -ForegroundColor White

# ── preflight ────────────────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'node was not found on PATH. Install Node.js 22.19 or newer.' }
$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) { throw "node $nodeVersion is too old; 22.19 or newer is required." }

$dshHomeDir = Resolve-DshHome
$profileDir = Join-Path (Join-Path $dshHomeDir 'profiles') $Profile
if (-not (Test-Path -LiteralPath $profileDir)) {
    throw "Profile '$Profile' was not found at $profileDir. Start it once with: dsh $Profile"
}
$manifestPath = Join-Path $profileDir 'package.json'
$stateDir = Join-Path $profileDir '.dsh-copy-file'
$statePath = Join-Path $stateDir 'install.json'
$targetDir = Join-Path (Join-Path $profileDir 'node_modules') $PackageName
Write-Step "profile      : $profileDir"
Write-Step "harness home : $dshHomeDir"

# ── generated browser bundle must be current ─────────────────────────────────
Push-Location $PackageRoot
try {
    & node scripts/vendor-client.mjs --check 2>&1 | ForEach-Object { Write-Step $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Step 'regenerating lib/client.js from the installed dsh bundle'
        & node scripts/vendor-client.mjs
        if ($LASTEXITCODE -ne 0) { throw 'vendor-client.mjs failed; check that dsh 0.2.0-rc.2 is installed.' }
    }
} finally {
    Pop-Location
}

# ── already installed? ───────────────────────────────────────────────────────
$version = (Read-JsonFile (Join-Path $PackageRoot 'package.json')).version
$manifest = Read-JsonFile $manifestPath
$bundles = @()
if ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles) { $bundles = @($manifest.dsh.profile.bundles) }
$installed = (Test-Path -LiteralPath (Join-Path $targetDir 'package.json'))
if ($installed -and -not $Force) {
    $installedVersion = (Read-JsonFile (Join-Path $targetDir 'package.json')).version
    if ($installedVersion -eq $version -and ($bundles -contains $PackageName)) {
        Write-Ok "already installed ($version); pass -Force to reinstall"
        exit 0
    }
}

# ── record the original manifest once ────────────────────────────────────────
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir | Out-Null }
if (-not (Test-Path -LiteralPath $statePath)) {
    $state = [ordered]@{
        package       = $PackageName
        version       = $version
        profile       = $Profile
        installedAt   = (Get-Date).ToString('o')
        bundlesBefore = $bundles
        pinnedDsh     = '0.2.0-rc.2'
    }
    Write-JsonFile $statePath $state
    Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $stateDir 'package.json.before') -Force
    Write-Ok 'recorded the pre-install profile manifest'
} else {
    Write-Step 'keeping the existing install record (idempotent)'
}

# ── copy the package into the profile ────────────────────────────────────────
if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$include = @('lib', 'src', 'scripts', 'helper', 'SKILL.md', 'README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE', 'cordis.patch.yml', 'package.json')
foreach ($item in $include) {
    $source = Join-Path $PackageRoot $item
    if (-not (Test-Path -LiteralPath $source)) { continue }
    Copy-Item -LiteralPath $source -Destination $targetDir -Recurse -Force
}
Write-Ok "copied package to $targetDir"

# ── enable the bundle row ────────────────────────────────────────────────────
if ($bundles -notcontains $PackageName) {
    $bundles = @($bundles) + $PackageName
    if (-not $manifest.dsh) { $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
    if (-not $manifest.dsh.profile) { $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
    $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force
    Write-JsonFile $manifestPath $manifest
    Write-Ok "enabled bundle '$PackageName' (it must stay last so its patch can disable ui-open-in-app)"
} else {
    Write-Ok "bundle '$PackageName' is already enabled"
}

# ── smoke check the composed tree ────────────────────────────────────────────
Write-Step 'checking the composed configuration'
$dump = & dsh --profile $Profile --dump-config 2>&1 | Out-String
if ($dump -notmatch 'ui-open-in-app-copy-file') {
    Write-Warn 'the composed config does not list the row yet; restart dsh if the page does not show the menu'
} else {
    Write-Ok 'composed config contains the row'
}

Write-Host ""
Write-Host "Installed. Refresh http://127.0.0.1:3080 to load the new client bundle." -ForegroundColor Green
Write-Host "Verify with: powershell -ExecutionPolicy Bypass -File scripts/verify.ps1" -ForegroundColor Gray
Write-Host "Remove with: powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1" -ForegroundColor Gray
