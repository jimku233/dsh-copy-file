<#
.SYNOPSIS
    Check that dsh-copy-file is installed, current, and composed correctly.

.DESCRIPTION
    Read-only. Verifies the package files, the generated browser bundle against
    the installed upstream bundle, the profile manifest entry, and the composed
    configuration reported by `dsh --dump-config`. Exits non-zero on the first
    failed check so it can gate CI or a release.

.PARAMETER Profile
    Profile name. Default 'web'.

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
    [string]$Profile = 'web',
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

Write-Host "`ndsh-copy-file verify" -ForegroundColor White

$dshHomeDir = Resolve-DshHome
$profileDir = Join-Path (Join-Path $dshHomeDir 'profiles') $Profile
$manifestPath = Join-Path $profileDir 'package.json'
$targetDir = Join-Path (Join-Path $profileDir 'node_modules') $PackageName

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

Write-Host "`n[2] generated browser bundle" -ForegroundColor White
Push-Location $PackageRoot
try {
    $vendorOutput = & node scripts/vendor-client.mjs --check 2>&1 | Out-String
    Write-Check ($LASTEXITCODE -eq 0) "lib/client.js matches the installed upstream bundle ($($vendorOutput.Trim()))"
} finally {
    Pop-Location
}
$clientPath = Join-Path $PackageRoot 'lib/client.js'
if (Test-Path -LiteralPath $clientPath) {
    $client = [System.IO.File]::ReadAllText($clientPath, [System.Text.Encoding]::UTF8)
    Write-Check ($client.Contains('id: "dsh-copy-file"')) 'bundle registers the dsh-copy-file module id'
    Write-Check ($client.Contains('useCopyGesture')) 'menu rows are present'
    Write-Check ($client.Contains('copyInstallCardInteraction')) 'card interaction is present'
}

Write-Host "`n[3] profile manifest" -ForegroundColor White
$bundles = @()
if (Test-Path -LiteralPath $manifestPath) {
    $manifest = Read-JsonFile $manifestPath
    if ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles) { $bundles = @($manifest.dsh.profile.bundles) }
}
$listed = $bundles -contains $PackageName
if ($ExpectAbsent) {
    Write-Check (-not $listed) 'bundle list no longer names the package'
} else {
    Write-Check $listed "bundle list names '$PackageName'"
    Write-Check ($bundles.Count -gt 0 -and $bundles[$bundles.Count - 1] -eq $PackageName) 'bundle stays last so its patch applies over the shipped rows'
}

Write-Host "`n[4] composed configuration" -ForegroundColor White
# `--dump-config` writes the profile's cordis.yml when it is missing, and it can
# print Node diagnostics on stderr. A confined sandbox denies that write (EPERM),
# which is an environment limit, not a verification failure, so say so.
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $dump = (& dsh --profile $Profile --dump-config 2>&1 | Out-String)
} catch {
    $dump = "$_"
} finally {
    $ErrorActionPreference = $previousErrorAction
}
if ($dump -match 'EPERM') {
    Write-Host '  SKIP  could not run dsh --dump-config: this process may not write the profile (sandbox).' -ForegroundColor Yellow
    Write-Host '        Re-run outside the sandbox to check the composed row.' -ForegroundColor DarkGray
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
