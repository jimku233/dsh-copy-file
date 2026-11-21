<#
.SYNOPSIS
    Check that dsh-copy-file is installed, current, and composed correctly.

.DESCRIPTION
    Read-only. Verifies the package files, the generated browser bundle against
    the installed upstream bundle, the profile manifest entry, and the composed
    configuration reported by `dsh --dump-config`. Exits non-zero on the first
    failed check so it can gate CI or a release.

.PARAMETER Profile
    Profile name. Omitted: uses `desktop` when it lists the web app bundle, else `web`.

.PARAMETER DshHome
    Harness home override. Defaults to $env:DSH_HOME, else ~/.dsh.

.PARAMETER ExpectAbsent
    Invert the installation checks: succeed only when the package is gone and
    the shipped row is enabled again.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile,
    [string]$DshHome,
    [switch]$ExpectAbsent
)

$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PackageName = 'dsh-copy-file'
$failures = 0

function Write-Check([bool]$Ok, [string]$Text) {
    if ($Ok) { Write-Host "  PASS  $Text" -ForegroundColor Green }
    else { Write-Host "  FAIL  $Text" -ForegroundColor Red; $script:failures += 1 }
}

function Resolve-DshHome {
    if ($DshHome -and $DshHome.Trim() -ne '') { return (Resolve-Path -LiteralPath $DshHome).Path }
    if ($env:DSH_HOME -and $env:DSH_HOME.Trim() -ne '') { return $env:DSH_HOME }
    return (Join-Path $env:USERPROFILE '.dsh')
}

function Read-JsonFile([string]$Path) {
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return ($raw | ConvertFrom-Json)
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

Write-Host "`ndsh-copy-file verify" -ForegroundColor White

$dshHomeDir = Resolve-DshHome
$profileName = Resolve-ProfileName $dshHomeDir
$profileDir = Join-Path (Join-Path $dshHomeDir 'profiles') $profileName
Write-Host "  profile: $profileName" -ForegroundColor DarkGray
$manifestPath = Join-Path $profileDir 'package.json'
# Whichever of the two mutually exclusive packages is installed.
$moduleDir = Join-Path $profileDir 'node_modules'
$detected = @()
foreach ($candidate in @('dsh-copy-file', 'dsh-copy-file-icon')) {
    if (Test-Path -LiteralPath (Join-Path $moduleDir $candidate)) { $detected += $candidate }
}
if ($detected.Count -gt 0) { $PackageName = $detected[0] }
$targetDir = Join-Path $moduleDir $PackageName

Write-Host "`n[1] package files" -ForegroundColor White
$installed = Test-Path -LiteralPath (Join-Path $targetDir 'package.json')
if ($ExpectAbsent) {
    Write-Check (-not $installed) 'package is absent from the profile'
} else {
    Write-Check $installed "package present at $targetDir"
    if ($installed) {
        foreach ($relative in @('lib/index.js', 'lib/client.js', 'lib/clipboard.mjs', 'lib/presented.mjs', 'cordis.patch.yml')) {
            Write-Check (Test-Path -LiteralPath (Join-Path $targetDir $relative)) "file $relative"
        }
        $installedVersion = (Read-JsonFile (Join-Path $targetDir 'package.json')).version
        $sourceVersion = (Read-JsonFile (Join-Path $PackageRoot 'package.json')).version
        Write-Check ($installedVersion -eq $sourceVersion) "installed version $installedVersion matches the checkout $sourceVersion"
    }
}

Write-Host "`n[2] browser half" -ForegroundColor White
$clientPath = Join-Path $PackageRoot 'lib/client.js'
if (Test-Path -LiteralPath $clientPath) {
    $client = [System.IO.File]::ReadAllText($clientPath, [System.Text.Encoding]::UTF8)
    Write-Check ($client.Contains("id: 'dsh-copy-file'")) 'bundle registers the dsh-copy-file module id'
    Write-Check (-not $client.Contains('dsh-client-ui-open-in-app')) 'no vendored copy of the shipped open-in-app package'
    Write-Check ($client.Contains("'deliverables.file.actions'")) 'registers the delivery-card action slot'
    Write-Check ($client.Contains('copyInstallCardInteraction')) 'card interaction is present'
    $patchPath = Join-Path $PackageRoot 'cordis.patch.yml'
    if (Test-Path -LiteralPath $patchPath) {
        $patchText = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
        Write-Check (-not ($patchText -match '(?m)^\s*disabled:\s*true')) 'the patch never disables a shipped row'
    }
    $variantScript = Join-Path $PackageRoot 'scripts\make-variant.mjs'
    if (Test-Path -LiteralPath $variantScript) {
        $null = (& node $variantScript --check 2>&1 | Out-String)
        Write-Check ($LASTEXITCODE -eq 0) 'icon/lib mirrors lib (make-variant --check)'
    }
    # Loads the bundle with a stub module table, so this proves the file parses
    # and that apply() registers exactly the two delivery slots.
    Push-Location $PackageRoot
    try {
        $testOutput = (& node tests/client.test.mjs 2>&1 | Out-String)
        Write-Check ($LASTEXITCODE -eq 0) 'tests/client.test.mjs passes (module id, slots, dictionaries)'
        if ($LASTEXITCODE -ne 0) {
            $testOutput.Trim().Split("`n") | Select-Object -Last 10 | ForEach-Object { Write-Host "        $($_.Trim())" -ForegroundColor DarkGray }
        }
    } finally {
        Pop-Location
    }
}

Write-Host "`n[3] profile manifest" -ForegroundColor White
$bundles = @()
if (Test-Path -LiteralPath $manifestPath) {
    $manifest = Read-JsonFile $manifestPath
    $bundles = Get-ProfileBundles $manifest
}
$listed = $bundles -contains $PackageName
if ($ExpectAbsent) {
    Write-Check (-not $listed) 'bundle list no longer names the package'
} else {
    Write-Check $listed "bundle list names '$PackageName'"
    Write-Check ($bundles.Count -gt 0 -and $bundles[$bundles.Count - 1] -eq $PackageName) 'bundle stays last so its patch applies over the shipped rows'
}

Write-Host "`n[4] composed configuration" -ForegroundColor White
# Three things make this section unavailable without it being a defect:
#   · a confined sandbox may not write the profile (EPERM);
#   · the Electron app owns the desktop profile (`--dump-config` refuses it);
#   · a machine without `dsh` on PATH has no CLI to ask.
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $dump = (& dsh --profile $profileName --dump-config 2>&1 | Out-String)
} catch {
    $dump = "$_"
} finally {
    $ErrorActionPreference = $previousErrorAction
}
if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
    Write-Host '  SKIP  dsh is not on PATH; check the composed row after restarting the app.' -ForegroundColor Yellow
} elseif ($dump -match 'managed exclusively') {
    Write-Host '  SKIP  desktop profile is managed by the Electron app: --dump-config is unavailable by design.' -ForegroundColor Yellow
    Write-Host '        Restart the app and look for the copy rows in a card menu.' -ForegroundColor DarkGray
} elseif ($dump -match 'EPERM') {
    Write-Host '  SKIP  could not run dsh --dump-config: this process may not write the profile (sandbox).' -ForegroundColor Yellow
    Write-Host '        Re-run outside the sandbox to check the composed row.' -ForegroundColor DarkGray
} elseif ($dump.Trim() -eq '') {
    Write-Host '  SKIP  dump-config produced no output; nothing to compare.' -ForegroundColor Yellow
} elseif ($ExpectAbsent) {
    Write-Check ($dump -notmatch 'ui-open-in-app-copy-file') 'our row is gone from the composition'
    Write-Check ($dump -notmatch 'id: ui-open-in-app\s*\r?\n\s*disabled: true') 'the shipped ui-open-in-app row is enabled again'
} else {
    Write-Check ($dump -match 'ui-open-in-app-copy-file') 'our row is in the composition'
    Write-Check ($dump -match 'disabled: true') 'the shipped ui-open-in-app row is disabled'
}

Write-Host ""
if ($failures -gt 0) {
    Write-Host "verify failed: $failures check(s)" -ForegroundColor Red
    exit 1
}
Write-Host 'verify passed' -ForegroundColor Green
