#Requires -Version 5.1
<#
.SYNOPSIS
  Stops the Ellyra Pulse dev server started by start.ps1.
#>
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$PidFile = Join-Path $ScriptDir ".ellyra-pulse.pid"

if (-not (Test-Path $PidFile)) {
  Write-Host "No PID file found ($PidFile) — Ellyra Pulse doesn't look like it's running via start.ps1."
  exit 0
}

$targetPid = Get-Content $PidFile -ErrorAction SilentlyContinue
$proc = if ($targetPid) { Get-Process -Id $targetPid -ErrorAction SilentlyContinue } else { $null }

if (-not $proc) {
  Write-Host "Process $targetPid is not running. Cleaning up stale PID file."
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  exit 0
}

Write-Host "Stopping Ellyra Pulse (PID $targetPid)..."
Stop-Process -Id $targetPid -ErrorAction SilentlyContinue

for ($i = 0; $i -lt 10; $i++) {
  if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) {
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host "Stopped."
    exit 0
  }
  Start-Sleep -Seconds 1
}

Write-Host "Process didn't exit in time, forcing..."
Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
Remove-Item $PidFile -ErrorAction SilentlyContinue
Write-Host "Stopped."
