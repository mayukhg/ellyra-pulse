#Requires -Version 5.1
<#
.SYNOPSIS
  Starts the Ellyra Pulse app (frontend + backend API, single TanStack Start process).
.PARAMETER Port
  Port to bind (default 5173).
.PARAMETER Hostname
  Host/interface to bind (default 127.0.0.1).
.PARAMETER WithPostgres
  Use the local Postgres database created by scripts/setup-postgres.sh instead of the
  in-memory store. Does not start Postgres itself.
.PARAMETER Shadow
  Sets INGESTION_MODE=shadow: ingest requests are evaluated but not persisted or paged.
.NOTES
  Written to mirror start.sh but not tested on Windows in this environment (no pwsh
  available) — please verify manually before relying on it.
#>
param(
  [int]$Port = 5173,
  [string]$Hostname = "127.0.0.1",
  [switch]$WithPostgres,
  [switch]$Shadow
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$PidFile = Join-Path $ScriptDir ".ellyra-pulse.pid"
$LogFile = Join-Path $ScriptDir ".ellyra-pulse.log"
$EnvFile = Join-Path $ScriptDir ".env"

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

# Generate .env with secrets on first run — src/backend/auth.ts requires these to be set, or
# every request fails with a 500. See .env.example for the full list of options.
if (-not (Test-Path $EnvFile)) {
  Write-Host "No .env found — generating one with fresh secrets (see .env.example for what else you can set)."
  $authSecret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  $ingestSecret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  @("AUTH_JWT_SECRET=$authSecret", "INGEST_HMAC_SECRET=$ingestSecret") | Set-Content -Path $EnvFile -Encoding ascii
}

Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
  }
}

if ($WithPostgres) {
  if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = "postgres://ellyra:ellyra_dev_pw@127.0.0.1:5432/ellyra_pulse"
  }
  $checkResult = & psql $env:DATABASE_URL -c "SELECT 1" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Could not connect to $($env:DATABASE_URL). Run scripts/setup-postgres.sh first (and check Postgres is running)."
    exit 1
  }
  Write-Host "Using Postgres at $($env:DATABASE_URL)"
} else {
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  Write-Host "Using the in-memory store (pass -WithPostgres to use a real database instead)."
}

if ($Shadow) {
  $env:INGESTION_MODE = "shadow"
  Write-Host "INGESTION_MODE=shadow -- ingest requests will be evaluated but not persisted or paged."
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
Write-Host "Mint a dev API token with: `$env:AUTH_JWT_SECRET='...'; node scripts/mint-dev-token.mjs"
Write-Host "Stop with: .\stop.ps1"
