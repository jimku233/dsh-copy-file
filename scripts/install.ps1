<#
.SYNOPSIS
    Install dsh-copy-file into one dsh profile (default: auto-detect desktop, then web).

.DESCRIPTION
    Idempotent. Copies this package into the profile's node_modules, appends it
    to dsh.profile.bundles, and records the pre-install manifest so uninstall can
    remove exactly its own entry. Never edits a file inside the dsh installation:
    the feature is one bundle row plus a package the profile owns.

    Works with Windows PowerShell 5.1 (this file is UTF-8 with BOM on purpose:
    5.1 reads BOM-less scripts as ANSI and mangles the quotes).

    Node 22.19+ is required. A `dsh` on PATH is optional: it is only used for a
    version hint and for the final composed-config check, which the Electron
    "desktop" profile refuses by design.

.PARAMETER Profile
    Profile name. Omitted: uses `desktop` when that profile exists and lists the
    web app bundle, otherwise `web`.

.PARAMETER DshHome
    Harness home override. Defaults to $env:DSH_HOME, else ~/.dsh.

.PARAMETER Force
    Reinstall even when the same version is already present.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/install.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile,
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

function Get-ProfileBundles($Manifest) {
    if ($Manifest.dsh -and $Manifest.dsh.profile -and $Manifest.dsh.profile.bundles) {
        return @($Manifest.dsh.profile.bundles)
    }
    return @()
}

function Resolve-ProfileName([string]$HarnessHome) {
    if ($Profile -and $Profile.Trim() -ne '') { return $Profile.Trim() }
    $desktopDir = Join-Path (Join-Path $HarnessHome 'profiles') 'desktop'
    $desktopManifest = Join-Path $desktopDir 'package.json'
    if (Test-Path -LiteralPath $desktopManifest) {
        try {
            $bundles = Get-ProfileBundles (Read-JsonFile $desktopManifest)
            if ($bundles -contains '@deepseek-ai/dsh-web-app') { return 'desktop' }
        } catch {
            # A malformed desktop manifest is not a reason to guess wrong; fall back to web.
        }
    }
    return 'web'
}

Write-Host "`ndsh-copy-file installer" -ForegroundColor White

# ── preflight ────────────────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'node was not found on PATH. Install Node.js 22.19 or newer.' }
$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) { throw "node $nodeVersion is too old; 22.19 or newer is required." }

$dshHomeDir = Resolve-DshHome
$profileName = Resolve-ProfileName $dshHomeDir
$profileDir = Join-Path (Join-Path $dshHomeDir 'profiles') $profileName
if (-not (Test-Path -LiteralPath $profileDir)) {
    throw "Profile '$profileName' was not found at $profileDir. Start the app (or 'dsh $profileName') once, then re-run."
}
$manifestPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "No package.json in $profileDir; that profile is not initialized." }
$stateDir = Join-Path $profileDir '.dsh-copy-file'
$statePath = Join-Path $stateDir 'install.json'
$targetDir = Join-Path (Join-Path $profileDir 'node_modules') $PackageName
Write-Step "profile      : $profileName ($profileDir)"
Write-Step "harness home : $dshHomeDir"

# A PATH `dsh` may be an older npm install while the Electron app is newer; this
# is a hint only, and the bundle check below is the real gate.
$dshVersion = ''
$dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
if ($dshCmd) {
    try { $dshVersion = ((& dsh --version 2>$null | Select-Object -First 1) | Out-String).Trim() } catch { $dshVersion = '' }
}
if ($dshVersion -ne '' -and $dshVersion -notmatch '^0\.[23]\.') {
    Write-Warn "dsh $dshVersion on PATH is outside the versions this release knows (0.2.0-rc.2 / 0.2.1-rc.3)"
}

# ── generated browser bundle must be current ─────────────────────────────────
Push-Location $PackageRoot
try {
    $vendorCheck = (& node scripts/vendor-client.mjs --check 2>&1 | Out-String)
    $vendorCheck.Trim().Split("`n") | Where-Object { $_.Trim() -ne '' } | ForEach-Object { Write-Step $_.Trim() }
    if ($LASTEXITCODE -ne 0) {
        if ($vendorCheck -match 'Could not find') {
            # Electron-only machine: the app carries dsh inside app.asar, so there
            # is no on-disk upstream bundle to compare against. The committed
            # lib/client.js is the artifact that gets installed.
            Write-Warn 'no local dsh install to compare against; using the committed lib/client.js'
        } else {
            Write-Step 'regenerating lib/client.js from the installed dsh bundle'
            & node scripts/vendor-client.mjs
            if ($LASTEXITCODE -ne 0) {
                throw 'vendor-client.mjs failed. Install the matching dsh release (see the message above) or pass --force.'
            }
        }
    }
} finally {
    Pop-Location
}

# ── already installed? ───────────────────────────────────────────────────────
$version = (Read-JsonFile (Join-Path $PackageRoot 'package.json')).version
$manifest = Read-JsonFile $manifestPath
$bundles = Get-ProfileBundles $manifest
$installed = Test-Path -LiteralPath (Join-Path $targetDir 'package.json')
if ($installed -and -not $Force) {
    $installedVersion = (Read-JsonFile (Join-Path $targetDir 'package.json')).version
    if ($installedVersion -eq $version -and ($bundles -contains $PackageName)) {
        Write-Ok "already installed ($version); pass -Force to reinstall"
        Write-Host "`nNothing to do. Restart the app if the card menu does not show the copy rows." -ForegroundColor Green
        exit 0
    }
}

# ── record the pre-install manifest once ─────────────────────────────────────
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir | Out-Null }
if (-not (Test-Path -LiteralPath $statePath)) {
    $state = [ordered]@{
        package       = $PackageName
        version       = $version
        profile       = $profileName
        installedAt   = (Get-Date).ToString('o')
        bundlesBefore = $bundles
        pinnedDsh     = $dshVersion
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
$include = @(
    'lib', 'src', 'scripts', 'cordis.patch.yml', 'package.json',
    'SKILL.md', 'README.md', 'README.en.md', 'CHANGELOG.md',
    'CONTRIBUTORS.md', 'LICENSE', 'NOTICE'
)
foreach ($item in $include) {
    $source = Join-Path $PackageRoot $item
    if (-not (Test-Path -LiteralPath $source)) { continue }
    Copy-Item -LiteralPath $source -Destination $targetDir -Recurse -Force
}
Write-Ok "copied package $version to $targetDir"

# ── enable the bundle row (always last) ──────────────────────────────────────
if ($bundles -notcontains $PackageName) {
    $bundles = @($bundles) + $PackageName
    if (-not $manifest.dsh) { $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
    if (-not $manifest.dsh.profile) { $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
    $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force
    Write-JsonFile $manifestPath $manifest
    Write-Ok "enabled bundle '$PackageName' (kept last so its patch applies over the shipped rows)"
} else {
    Write-Ok "bundle '$PackageName' is already enabled"
    if ($bundles[-1] -ne $PackageName) {
        Write-Warn "the bundle is not last in dsh.profile.bundles; move it to the end or ui-open-in-app will not be disabled"
    }
}

# ── smoke check the composed tree ────────────────────────────────────────────
# The Electron app owns the desktop profile, so `--dump-config` refuses it by
# design; that is not an install failure. Classify the outcome instead of
# guessing: refused-by-app, row present, sandbox refusal, empty output, or a
# real "row absent" warning.
Write-Step 'checking the composed configuration'
$managed = $false
$dump = ''
if ($dshCmd) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $dump = (& dsh --profile $profileName --dump-config 2>&1 | Out-String) } catch { $dump = "$($_.Exception.Message)" } finally { $ErrorActionPreference = $previous }
}
if ($dump -match 'managed exclusively') {
    # The Electron app owns this profile; composing it from the CLI is refused by
    # design, so this says nothing about the install being incomplete.
    $managed = $true
    Write-Step 'profile is managed by the Electron application; dump-config is unavailable here (expected)'
} elseif ($dump -match 'ui-open-in-app-copy-file') {
    Write-Ok 'composed config contains the row'
} elseif ($dump -match 'EPERM') {
    Write-Step 'could not run dsh --dump-config here (sandbox cannot write the profile); check after a restart'
} elseif ($dump.Trim() -ne '') {
    Write-Warn 'the composed config does not show the row yet; restart DSH to apply the new bundle'
} else {
    Write-Step 'dump-config produced no output; skipping the composed-tree check'
}

Write-Host ""
Write-Host "Installed. The client bundle is resolved at launch, so a restart is required even on a live-reload profile." -ForegroundColor Green
if ($managed) {
    Write-Host 'Quit the DeepSeek Harness desktop app completely, start it again, then open a chat with a file card.' -ForegroundColor Gray
} else {
    Write-Host 'Stop dsh web (or quit the app) and start it again, then reopen the page.' -ForegroundColor Gray
}
Write-Host "Verify with: powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -Profile $profileName" -ForegroundColor Gray
Write-Host "Remove with: powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1 -Profile $profileName" -ForegroundColor Gray
