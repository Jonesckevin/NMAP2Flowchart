<#
.SYNOPSIS
    Builds every release artifact under release/.

.DESCRIPTION
    One command for the whole release: checks (lint, API tests), the four single-file executables,
    the two portable folders plus their zips, release/app.cjs and the packaged draw.io plugin.
    The SPA is compiled once and reused, every step stops the run on failure, and the tail of the
    script verifies checksums, archive contents and that the shipped bundle embeds the fresh build.

.EXAMPLE
    .\build-release.ps1                # checks, executables (4 targets), portable folders + zips, app.cjs, draw.io plugin

.EXAMPLE
    .\build-release.ps1 -SkipInstall   # node_modules is already up to date

.EXAMPLE
    .\build-release.ps1 -SkipPortable  # executables, app.cjs and the plugin only

.EXAMPLE
    .\build-release.ps1 -SkipPlugin -SkipBundle   # just the executables and portable folders

.EXAMPLE
    .\build-release.ps1 -Clean         # remove previous artifacts first
#>
[CmdletBinding()]
param(
    # Skip `npm ci` when node_modules already matches package-lock.json.
    [switch]$SkipInstall,
    # Skip `npm run lint` and `npm run test:api`.
    [switch]$SkipChecks,
    [switch]$SkipExecutables,
    # Skip the portable folders and their zips.
    [switch]$SkipPortable,
    # Skip release/app.cjs, the bundle the release workflow publishes.
    [switch]$SkipBundle,
    # Skip validating and packaging drawio-plugin/ into release/.
    [switch]$SkipPlugin,
    # Skip the post-build HTTP smoke test of the host binary.
    [switch]$NoSmoke,
    # Delete artifacts from an earlier run before building (nothing else is touched).
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date

$appDir = Join-Path $PSScriptRoot 'App'
$releaseDir = Join-Path $PSScriptRoot 'release'
$riskExample = Join-Path $PSScriptRoot 'risk-policy.example.json'
$portableNames = @('win-x64', 'linux-x64')
$pluginDir = Join-Path $PSScriptRoot 'drawio-plugin'
$pluginStage = Join-Path $releaseDir 'nmap2drawio-plugin'
$pluginZip = Join-Path $releaseDir 'nmap2drawio-plugin.zip'

function Invoke-Step {
    param([string]$Name, [string[]]$CommandArgs)

    Write-Host "==> $Name" -ForegroundColor Cyan
    $timer = [Diagnostics.Stopwatch]::StartNew()
    & $CommandArgs[0] @($CommandArgs | Select-Object -Skip 1)
    if ($LASTEXITCODE) { throw "$Name failed (exit code $LASTEXITCODE)" }
    $timer.Stop()
    Write-Host ("    {0:n1}s" -f $timer.Elapsed.TotalSeconds) -ForegroundColor DarkGray
}

function Assert-File {
    param([string]$Path, [string]$What)

    if (-not (Test-Path -LiteralPath $Path)) { throw "$What is missing: $Path" }
}

function Test-Checksums {
    param([string]$File)

    $bad = 0
    foreach ($line in (Get-Content -LiteralPath $File)) {
        if ($line -notmatch '^([0-9a-f]{64})\s\s(.+)$') { continue }
        $expected = $Matches[1]
        $name = $Matches[2].Trim()
        $path = Join-Path (Split-Path -Parent $File) $name
        if (-not (Test-Path -LiteralPath $path)) {
            Write-Host "    missing  $name" -ForegroundColor Red
            $bad++
            continue
        }
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            Write-Host "    mismatch $name" -ForegroundColor Red
            $bad++
        }
    }
    if ($bad -gt 0) { throw "SHA256SUMS.txt does not match $bad artifact(s)" }
    Write-Host '    all checksums match' -ForegroundColor Green
}

if (-not (Test-Path (Join-Path $appDir 'package.json'))) {
    throw "App/package.json not found next to $($MyInvocation.MyCommand.Path)"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm not found in PATH (install Node.js 22 or newer)'
}

# Fail fast with a useful message instead of a half-built release.
foreach ($required in @(
    'App\package-lock.json',
    'App\scripts\build-standalone.mjs',
    'docker\nginx.conf',
    'risk-policy.example.json',
    'drawio-plugin\package-files.txt')) {
    Assert-File (Join-Path $PSScriptRoot $required) $required
}

# The shipped paths live in the plugin folder so the release workflow reads the
# same list and its asset matches what this script writes.
$pluginFiles = Get-Content -LiteralPath (Join-Path $pluginDir 'package-files.txt') |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }

# Needed for the portable and plugin zips (Windows PowerShell 5.1 does not load it by default).
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue

$nodeVersion = (& node --version) -replace '^v', ''
Write-Host "==> Node.js $nodeVersion, npm $(& npm --version)" -ForegroundColor Cyan

if ($Clean -and (Test-Path $releaseDir)) {
    # Only names this pipeline writes (plus the nmap2flowio-* artifacts from before the
    # rename), so a hand-placed file in release/ survives.
    $generated = Get-ChildItem -LiteralPath $releaseDir |
        Where-Object { $_.Name -match '^(nmap2flow(io|chart)-[^\\/]+|nmap2drawio-plugin(\.zip)?|app\.cjs(\.sha256)?|SHA256SUMS\.txt|README\.txt|risk-policy\.example\.json)$' }
    foreach ($item in $generated) {
        Write-Host "    removing $($item.Name)" -ForegroundColor DarkGray
        Remove-Item -LiteralPath $item.FullName -Recurse -Force
    }
}

Push-Location $appDir
try {
    if (-not $SkipInstall) {
        Invoke-Step 'install dependencies (npm ci)' @('npm', 'ci')
    }
    if (-not $SkipChecks) {
        Invoke-Step 'lint (oxlint)' @('npm', 'run', 'lint')
        Invoke-Step 'API tests (node --test)' @('npm', 'run', 'test:api')
    }
    if (-not $SkipExecutables) {
        # --target all builds win-x64/arm64 and linux-x64/arm64 in one pass; the
        # SPA is compiled by the first step and reused by the portable build.
        $smoke = if ($NoSmoke) { @('--no-smoke') } else { @() }
        Invoke-Step 'single-file executables (all four targets)' (@('npm', 'run', 'standalone', '--', '--target', 'all') + $smoke)
    }
    if (-not $SkipPortable) {
        $smoke = if ($NoSmoke) { @('--no-smoke') } else { @() }
        # Reuse dist/ only when the executable step already rebuilt it.
        $frontend = if ($SkipExecutables) { @() } else { @('--skip-frontend') }
        Invoke-Step 'portable folders (signed node + app.cjs)' (@('npm', 'run', 'standalone:portable', '--') + $frontend + $smoke)

        # Same names the release workflow uploads, so a local build can be handed
        # out (or attached to a release) without renaming anything.
        foreach ($name in $portableNames) {
            $folder = Join-Path $releaseDir "nmap2flowchart-portable-$name"
            $zip = Join-Path $releaseDir "nmap2flowchart-portable-$name.zip"
            if (-not (Test-Path -LiteralPath $folder)) { throw "portable folder $name was not built" }
            if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
            Write-Host "==> zip portable folder $name" -ForegroundColor Cyan
            $timer = [Diagnostics.Stopwatch]::StartNew()
            # .NET instead of Compress-Archive: node.exe is ~90 MB and this is ~4x faster.
            [IO.Compression.ZipFile]::CreateFromDirectory(
                $folder,
                $zip,
                [IO.Compression.CompressionLevel]::Optimal,
                $true)
            $timer.Stop()
            Write-Host ("    {0:n0} MB in {1:n1}s" -f ((Get-Item -LiteralPath $zip).Length / 1MB), $timer.Elapsed.TotalSeconds) -ForegroundColor DarkGray
        }
    }
    if (-not $SkipBundle) {
        $smoke = if ($NoSmoke) { @('--no-smoke') } else { @() }
        $frontend = if ($SkipExecutables -and $SkipPortable) { @() } else { @('--skip-frontend') }
        Invoke-Step 'release/app.cjs (what the release workflow publishes)' (@('npm', 'run', 'standalone:bundle', '--') + $frontend + $smoke)
    }
}
finally {
    Pop-Location
}

if (-not $SkipPlugin) {
    # The plugin has no build step — it is mounted into draw.io as-is — so the
    # release job is to prove it still matches App/ and the bundled sample, then
    # package it so it can be handed over without cloning the repository.
    Write-Host '==> draw.io plugin' -ForegroundColor Cyan
    Invoke-Step 'plugin checks (loads it the way draw.io does)' @('node', (Join-Path $pluginDir 'check-plugin.mjs'))
    foreach ($file in @('plugins\nmap2drawio.js', 'webapp\js\PostConfig.js')) {
        Invoke-Step "plugin syntax ($file)" @('node', '--check', (Join-Path $pluginDir $file))
    }

    if (Test-Path -LiteralPath $pluginStage) { Remove-Item -LiteralPath $pluginStage -Recurse -Force }
    New-Item -ItemType Directory -Path $pluginStage | Out-Null
    foreach ($name in $pluginFiles) {
        Copy-Item -LiteralPath (Join-Path $pluginDir $name) -Destination $pluginStage -Recurse -Force
    }
    if (Test-Path -LiteralPath $pluginZip) { Remove-Item -LiteralPath $pluginZip -Force }
    Compress-Archive -LiteralPath $pluginStage -DestinationPath $pluginZip -CompressionLevel Optimal
    Write-Host "    packaged release/nmap2drawio-plugin/ + nmap2drawio-plugin.zip" -ForegroundColor DarkGray
    Write-Host '    a running draw.io stack mounts these files, so it picks them up on reload' -ForegroundColor DarkGray
}

Write-Host '==> verify' -ForegroundColor Cyan
Assert-File $riskExample 'risk-policy.example.json'
Assert-File (Join-Path $releaseDir 'risk-policy.example.json') 'risk-policy.example.json in release/'

if (-not $SkipExecutables) {
    foreach ($name in @('nmap2flowchart-win-x64.exe', 'nmap2flowchart-win-arm64.exe', 'nmap2flowchart-linux-x64', 'nmap2flowchart-linux-arm64')) {
        Assert-File (Join-Path $releaseDir $name) "executable $name"
    }
    Assert-File (Join-Path $releaseDir 'SHA256SUMS.txt') 'SHA256SUMS.txt'
    Test-Checksums (Join-Path $releaseDir 'SHA256SUMS.txt')
    if (-not (Select-String -LiteralPath (Join-Path $releaseDir 'README.txt') -Pattern 'NMAP_RISK_POLICY_FILE' -Quiet)) {
        throw 'release/README.txt does not mention NMAP_RISK_POLICY_FILE'
    }
}

if (-not $SkipPortable) {
    # `standalone:portable` builds the two default targets (win-x64, linux-x64);
    # arm64 is shipped as a single-file executable only.
    foreach ($name in $portableNames) {
        $folder = Join-Path $releaseDir "nmap2flowchart-portable-$name"
        Assert-File $folder "portable folder $name"
        Assert-File (Join-Path $folder 'app.cjs') "app.cjs in $name"
        Assert-File (Join-Path $folder 'README.txt') "README.txt in $name"
        Assert-File (Join-Path $folder 'risk-policy.example.json') "risk-policy.example.json in $name"
        if (-not (Select-String -LiteralPath (Join-Path $folder 'README.txt') -Pattern 'risk-policy\.example\.json' -Quiet)) {
            throw "the portable README in $name does not mention the risk policy example"
        }
        $launcher = if ($name.StartsWith('win')) { 'start.cmd' } else { 'start.sh' }
        Assert-File (Join-Path $folder $launcher) "$launcher in $name"
        $runtime = if ($name.StartsWith('win')) { 'node.exe' } else { 'node' }
        Assert-File (Join-Path $folder $runtime) "$runtime in $name"

        # The zip is what people download; make sure it really holds the folder.
        $zip = Join-Path $releaseDir "nmap2flowchart-portable-$name.zip"
        Assert-File $zip "portable zip $name"
        $archive = [IO.Compression.ZipFile]::OpenRead($zip)
        try {
            foreach ($entry in @($runtime, 'app.cjs', $launcher, 'README.txt')) {
                $expected = "nmap2flowchart-portable-$name/$entry"
                if (-not $archive.Entries.Where({ $_.FullName -eq $expected })) {
                    throw "portable zip $name is missing $expected"
                }
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    Write-Host '    portable folders and zips complete' -ForegroundColor Green
}

if (-not $SkipBundle) {
    $bundle = Join-Path $releaseDir 'app.cjs'
    Assert-File $bundle 'release/app.cjs'
    $shaFile = "$bundle.sha256"
    Assert-File $shaFile 'release/app.cjs.sha256'
    if (-not (Select-String -LiteralPath $shaFile -Pattern (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant() -Quiet)) {
        throw 'release/app.cjs.sha256 does not match release/app.cjs'
    }
    Write-Host '    app.cjs checksum matches' -ForegroundColor Green

    # The bundle must embed the SPA that was just compiled, not an older dist/.
    $distIndex = Join-Path $appDir 'dist\index.html'
    if (Test-Path -LiteralPath $distIndex) {
        $asset = [regex]::Match((Get-Content -LiteralPath $distIndex -Raw), 'assets/(index-[A-Za-z0-9_-]+\.js)').Groups[1].Value
        if (-not $asset) {
            throw "could not read the SPA asset name from App\dist\index.html"
        }
        if (-not (Select-String -LiteralPath $bundle -Pattern ([regex]::Escape($asset)) -Quiet)) {
            throw "release/app.cjs does not contain $asset — it was built from a stale dist/"
        }
        Write-Host "    app.cjs embeds the current build ($asset)" -ForegroundColor Green
    }
}

if (-not $SkipPlugin) {
    foreach ($name in $pluginFiles) {
        Assert-File (Join-Path $pluginStage $name) "draw.io plugin $name"
    }
    # The staged copy is what people get; prove it still parses.
    $stagedPlugin = Join-Path $pluginStage 'plugins\nmap2drawio.js'
    & node --check $stagedPlugin
    if ($LASTEXITCODE) { throw 'the packaged copy of plugins/nmap2drawio.js does not parse' }

    Assert-File $pluginZip 'release/nmap2drawio-plugin.zip'
    $unpacked = Join-Path ([IO.Path]::GetTempPath()) ('nmap2drawio-zip-' + [guid]::NewGuid().ToString('N'))
    try {
        Expand-Archive -LiteralPath $pluginZip -DestinationPath $unpacked
        foreach ($name in $pluginFiles) {
            Assert-File (Join-Path $unpacked "nmap2drawio-plugin\$name") "draw.io plugin $name in the zip"
        }
    }
    finally {
        Remove-Item -LiteralPath $unpacked -Recurse -Force -ErrorAction SilentlyContinue
    }
    $size = [math]::Round((Get-Item -LiteralPath $pluginZip).Length / 1KB)
    Write-Host "    plugin package complete ($size KB zip)" -ForegroundColor Green
}

Write-Host '==> release/' -ForegroundColor Green
Get-ChildItem $releaseDir | Sort-Object Name | Select-Object Mode, LastWriteTime, Length, Name | Format-Table -AutoSize

# One line per download with its size, so a release can be checked at a glance.
Write-Host '==> downloads' -ForegroundColor Cyan
$downloads = @(
    'app.cjs',
    'app.cjs.sha256',
    'nmap2flowchart-portable-win-x64.zip',
    'nmap2flowchart-portable-linux-x64.zip',
    'nmap2drawio-plugin.zip'
)
foreach ($name in $downloads) {
    $path = Join-Path $releaseDir $name
    if (Test-Path -LiteralPath $path) {
        $mb = (Get-Item -LiteralPath $path).Length / 1MB
        Write-Host ("    {0,-40} {1,8:n1} MB" -f $name, $mb) -ForegroundColor DarkGray
    }
}
foreach ($name in @('nmap2flowchart-win-x64.exe', 'nmap2flowchart-win-arm64.exe', 'nmap2flowchart-linux-x64', 'nmap2flowchart-linux-arm64')) {
    $path = Join-Path $releaseDir $name
    if (Test-Path -LiteralPath $path) {
        $mb = (Get-Item -LiteralPath $path).Length / 1MB
        Write-Host ("    {0,-40} {1,8:n1} MB  (release page)" -f $name, $mb) -ForegroundColor DarkGray
    }
}

$elapsed = (Get-Date) - $startedAt
if ($Clean) { Write-Host '    built from a clean release/' -ForegroundColor DarkGray }
Write-Host ("==> done in {0:n0}m {1:n0}s" -f [math]::Floor($elapsed.TotalMinutes), $elapsed.Seconds) -ForegroundColor Green
