param(
    [string]$Prefix = '24',
    [string]$NmapArgs = '-sV -O --traceroute',
    [string]$OutDir = 'scans'
)
$ErrorActionPreference = 'Stop'
$targets = @('192.168.0.0')
$nmap = (Get-Command nmap -ErrorAction SilentlyContinue).Source
if (-not $nmap) { throw 'nmap not found in PATH (winget install Insecure.Nmap)' }
$admin = [Security.Principal.WindowsBuiltInRole]::Administrator
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole($admin)) {
    Write-Host 'note: elevated shell needed for -O and raw scans (plus Npcap)'
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$fail = 0
foreach ($t in $targets) {
    $spec = if ($t -like '*.0') { "$t/$Prefix" } else { "$t/32" }
    Write-Host "==> $spec"
    & $nmap ($NmapArgs -split '\s+' | Where-Object { $_ }) -oX (Join-Path $OutDir "$($t.Replace('.', '-')).xml") $spec
    if ($LASTEXITCODE) { $fail++ }
}

Write-Host "wrote $((Get-ChildItem $OutDir -Filter *.xml).Count) file(s) to $OutDir, $fail failed"
if ($fail) { exit 1 }
