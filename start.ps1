#Requires -Version 5.1
<#
.SYNOPSIS
  Starts the Ellyra Pulse app (frontend + backend API, single TanStack Start process).
.PARAMETER Port
  Port to bind (default 5173).
.PARAMETER Hostname
  Host/interface to bind (default 127.0.0.1).
#>
param(
  [int]$Port = 5173,
  [string]$Hostname = "127.0.0.1"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$PidFile = Join-Path $ScriptDir ".ellyra-pulse.pid"
$LogFile = Join-Path $ScriptDir ".ellyra-pulse.log"

if (Test-Path $PidFile) {
  $existingPid = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
    Write-Host "Ellyra Pulse is already running (PID $existingPid). Run .\stop.ps1 first if you want to restart it."
    exit 0
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required but was not found on PATH. Install it from https://nodejs.org (v18+)."
  exit 1
}

$PkgRunner = "npm"
if ((Get-Command bun -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $ScriptDir "bun.lock"))) {
  $PkgRunner = "bun"
}

if (-not (Test-Path (Join-Path $ScriptDir "node_modules"))) {
  Write-Host "Installing dependencies with $PkgRunner (first run only)..."
  if ($PkgRunner -eq "bun") {
    & bun install
  } else {
    & npm install
  }
}

Write-Host "Starting Ellyra Pulse on http://${Hostname}:${Port} ..."

if ($PkgRunner -eq "bun") {
  $proc = Start-Process -FilePath "bun" -ArgumentList @("run", "dev", "--host", $Hostname, "--port", $Port) `
    -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err" -PassThru -WindowStyle Hidden
} else {
  $proc = Start-Process -FilePath "npm" -ArgumentList @("run", "dev", "--", "--host", $Hostname, "--port", $Port) `
    -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err" -PassThru -WindowStyle Hidden
}

$proc.Id | Out-File -FilePath $PidFile -Encoding ascii

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  if ($proc.HasExited) {
    Write-Error "Ellyra Pulse failed to start. Last log lines:"
    if (Test-Path $LogFile) { Get-Content $LogFile -Tail 30 | Write-Host }
    if (Test-Path "$LogFile.err") { Get-Content "$LogFile.err" -Tail 30 | Write-Host }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    exit 1
  }
  if ((Test-Path $LogFile) -and (Select-String -Path $LogFile -Pattern "ready in|Local:" -Quiet -ErrorAction SilentlyContinue)) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 1
}

Write-Host "Ellyra Pulse is running (PID $($proc.Id)). Logs: $LogFile"
Write-Host "Open: http://${Hostname}:${Port}"
Write-Host "Stop with: .\stop.ps1"
