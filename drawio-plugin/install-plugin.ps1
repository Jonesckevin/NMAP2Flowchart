<#
.SYNOPSIS
  Adds the NMAP import plugin to an existing draw.io (jgraph/drawio) container.

.DESCRIPTION
  Copies the plugin into the running container, enables third-party plugins
  (window.ALLOW_CUSTOM_PLUGINS) and, unless -NoAutoLoad is given, makes draw.io
  load it on every page load through js/PostConfig.js.

  Everything is idempotent: one marked block per file, skipped when already
  present. -Uninstall removes both blocks and the copied plugin files again.

  Changes made with `docker cp` live in the container layer, so they survive a
  restart but not `docker rm` / `docker compose up --build`. Re-run the script
  after recreating the container, or mount the files for good (see README.md).

.EXAMPLE
  .\install-plugin.ps1 -Container nmap2drawio

.EXAMPLE
  .\install-plugin.ps1 -Container drawio -BaseUrl http://drawio.lab:8080

.EXAMPLE
  .\install-plugin.ps1 -Container drawio -NoAutoLoad   # add it per browser instead

.EXAMPLE
  .\install-plugin.ps1 -Container drawio -Uninstall
#>
[CmdletBinding()]
param(
  # Name or ID of the running draw.io container. Defaults to the only running
  # container that publishes port 8080.
  [string] $Container,
  # Address printed in the instructions. Defaults to the container's published
  # 8080 port on localhost.
  [string] $BaseUrl,
  # Webapp root inside the container. Detected automatically when omitted.
  [string] $WebappDir,
  # Enable Extras > Plugins (custom plugin URLs) but do not load the plugin for
  # every user; each browser adds it under Extras > Plugins.
  [switch] $NoAutoLoad,
  # Peel the plugin out again and restore draw.io to its stock configuration.
  [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
$pluginFile = Join-Path $PSScriptRoot 'plugins/nmap2drawio.js'
$sampleFile = Join-Path $PSScriptRoot 'samples/lab-scan.xml'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string] $Message) { Write-Host "  $Message" }
function Stop-WithError([string] $Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Invoke-Docker([string[]] $Arguments, [switch] $AllowFailure) {
  $output = & docker @Arguments 2>&1
  $text = ($output | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
    Stop-WithError "docker $($Arguments -join ' ') failed:`n$text"
  }
  return $text
}

function Get-Lines([string] $Text) {
  return @($Text -split "\r?\n" | Where-Object { $_.Trim().Length -gt 0 })
}

# ---------------------------------------------------------------------------
# 1. Container
# ---------------------------------------------------------------------------
$dockerVersion = Invoke-Docker @('version', '--format', '{{.Server.Version}}') -AllowFailure
if ($dockerVersion -notmatch '^\d+\.\d+') { Stop-WithError "Docker is not reachable:`n$dockerVersion" }

if (-not $Container) {
  $drawio = Get-Lines (Invoke-Docker @('ps', '--filter', 'ancestor=jgraph/drawio', '--format', '{{.Names}}') -AllowFailure)
  $running = Get-Lines (Invoke-Docker @('ps', '--format', '{{.Names}}') -AllowFailure)
  if ($drawio.Count -eq 1) { $Container = $drawio[0] }
  elseif ($running.Count -eq 1) { $Container = $running[0] }
  elseif ($running.Count -eq 0) { Stop-WithError 'No running container found. Start draw.io first, then pass -Container <name>.' }
  else { Stop-WithError "Several containers are running; pick one with -Container <name>:`n  $($running -join "`n  ")" }
}

if ((Invoke-Docker @('inspect', '--format', '{{.State.Running}}', $Container) -AllowFailure) -ne 'true') {
  Stop-WithError "Container '$Container' is not running."
}
Write-Step "container  $Container"

# ---------------------------------------------------------------------------
# 2. Webapp root
# ---------------------------------------------------------------------------
if (-not $WebappDir) {
  $found = Invoke-Docker @('exec', $Container, 'sh', '-c',
    'ls -d /usr/local/tomcat/webapps/*/js/PostConfig.js 2>/dev/null | head -n 1') -AllowFailure
  if (-not $found) {
    Stop-WithError @"
Could not find <webapp>/js/PostConfig.js inside '$Container'.
Pass it explicitly, for example -WebappDir /usr/local/tomcat/webapps/draw.
"@
  }
  $WebappDir = $found -replace '/js/PostConfig\.js$', ''
}
Write-Step "webapp     $WebappDir"

$preConfig = "$WebappDir/js/PreConfig.js"
$postConfig = "$WebappDir/js/PostConfig.js"
$pluginPath = "$WebappDir/plugins/nmap2drawio.js"
$samplePath = "$WebappDir/plugins/samples/lab-scan.xml"

if (-not $BaseUrl) {
  $port = (Get-Lines (Invoke-Docker @('port', $Container, '8080/tcp') -AllowFailure) | Select-Object -First 1) -replace '.*:', ''
  if ($port -match '^\d+$') { $BaseUrl = "http://localhost:$port" } else { $BaseUrl = 'http://localhost:8080' }
}

# ---------------------------------------------------------------------------
# 3. Marked blocks (shared by install and uninstall)
# ---------------------------------------------------------------------------
$markerPattern = '(?s)\r?\n?// --- nmap2drawio begin ---.*?// --- nmap2drawio end ---[^\n]*\n?'

$preConfigBlock = @'
// --- nmap2drawio begin ---
// draw.io refuses plugins that are not built in unless this flag is set
// (js/diagramly/Init.js). It also enables Extras > Plugins, where a plugin can
// be added by URL per browser; that menu is hidden when the editor is opened
// with ?offline=1.
;window.ALLOW_CUSTOM_PLUGINS = true;
window.PLUGINS_BASE_PATH = window.PLUGINS_BASE_PATH || '';
// --- nmap2drawio end ---
'@

$postConfigBlock = @'
// --- nmap2drawio begin ---
// Loads the nmap -> draw.io import plugin (plugins/nmap2drawio.js) on every page
// load. Drop this block, or install with -NoAutoLoad, to only allow the plugin
// to be added by hand under Extras > Plugins.
// The leading semicolon matters: draw.io ships files that end without one, and
// without it a following "(" would be parsed as a call on the previous line.
;(function () {
  var src = (window.PLUGINS_BASE_PATH || '') + 'plugins/nmap2drawio.js';
  if (typeof window.mxscript === 'function') {
    window.mxscript(src);
    return;
  }
  var script = document.createElement('script');
  script.src = src;
  script.async = false;
  document.head.appendChild(script);
})();
// --- nmap2drawio end ---
'@

function Read-Remote([string] $RemotePath) {
  $temp = [System.IO.Path]::GetTempFileName()
  Invoke-Docker @('cp', "${Container}:${RemotePath}", $temp) -AllowFailure | Out-Null
  $text = if (Test-Path $temp) { [System.IO.File]::ReadAllText($temp) } else { '' }
  Remove-Item $temp -ErrorAction SilentlyContinue
  return $text
}

function Write-Remote([string] $RemotePath, [string] $Text) {
  $temp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($temp, $Text, $utf8NoBom)
  Invoke-Docker @('cp', $temp, "${Container}:${RemotePath}") | Out-Null
  Remove-Item $temp -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# 4. Uninstall
# ---------------------------------------------------------------------------
if ($Uninstall) {
  foreach ($file in @($preConfig, $postConfig)) {
    $text = Read-Remote $file
    if ($text -match 'nmap2drawio begin') {
      Write-Remote $file (([regex]::Replace($text, $markerPattern, "`n")).TrimEnd() + "`n")
      Write-Step "restored   $file"
    }
  }
  Invoke-Docker @('exec', $Container, 'sh', '-c', "rm -f '$pluginPath' '$samplePath'") | Out-Null
  Write-Step 'removed    plugins/nmap2drawio.js'
  Write-Step 'removed    plugins/samples/lab-scan.xml'
  Write-Host ''
  Write-Host "NMAP import plugin removed from '$Container'. Hard-reload the editor tab (Ctrl+F5)." -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------------------
# 5. Install
# ---------------------------------------------------------------------------
foreach ($file in @($pluginFile, $sampleFile)) {
  if (-not (Test-Path $file)) { Stop-WithError "Missing '$file' - keep the script next to the plugins/ and samples/ folders." }
}

Invoke-Docker @('exec', $Container, 'sh', '-c', "mkdir -p '$WebappDir/plugins/samples'") | Out-Null
Invoke-Docker @('cp', $pluginFile, "${Container}:${pluginPath}") | Out-Null
Invoke-Docker @('cp', $sampleFile, "${Container}:${samplePath}") | Out-Null
Write-Step 'copied     plugins/nmap2drawio.js'
Write-Step 'copied     plugins/samples/lab-scan.xml'

function Add-Block([string] $RemotePath, [string] $Block, [string] $Label) {
  $text = Read-Remote $RemotePath
  if ($text -match 'nmap2drawio begin') {
    Write-Step "unchanged  $RemotePath ($Label already enabled)"
    return
  }
  $blockText = ($Block.TrimEnd() -replace "\r\n", "`n")
  $separator = if ($text.Trim().Length -gt 0) { "`n`n" } else { '' }
  Write-Remote $RemotePath ($text.TrimEnd() + $separator + $blockText + "`n")
  Write-Step "patched    $RemotePath ($Label enabled)"
}

Add-Block $preConfig $preConfigBlock 'custom plugins'
if ($NoAutoLoad) {
  Write-Step "skipped    $postConfig (auto-load disabled by -NoAutoLoad)"
}
else {
  Add-Block $postConfig $postConfigBlock 'plugin auto-load'
}

# ---------------------------------------------------------------------------
# 6. What to do next
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host "NMAP import plugin installed in '$Container'" -ForegroundColor Green
Write-Host "  webapp      $WebappDir"
Write-Host '  variables   window.ALLOW_CUSTOM_PLUGINS = true'
Write-Host "              window.PLUGINS_BASE_PATH   = '' (webapp root)"
Write-Host "  sample      plugins/samples/lab-scan.xml  ->  'Load sample scan' in the dialog"
Write-Host ''
if ($NoAutoLoad) {
  Write-Host "  manual:     open $BaseUrl/ then Extras > Plugins > Custom..., enter"
  Write-Host '              plugins/nmap2drawio.js, click Add, Apply, then reload the tab.'
}
else {
  Write-Host "  use it:     open $BaseUrl/ then File > NMAP: import scan..."
  Write-Host '  manual:     Extras > Plugins > Custom... can add it per browser too'
  Write-Host '              (enter plugins/nmap2drawio.js, Add, Apply, reload).'
}
Write-Host ''
Write-Host 'Hard-reload the editor tab (Ctrl+F5) so the patched files are fetched.' -ForegroundColor Yellow
Write-Host '?offline=1 hides Extras > Plugins, so leave it off when adding the plugin by hand.' -ForegroundColor Yellow
Write-Host 'docker cp changes are lost when the container is recreated - re-run this script,' -ForegroundColor Yellow
Write-Host 'or mount these paths in compose (see README.md).' -ForegroundColor Yellow
