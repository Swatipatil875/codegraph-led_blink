# STM-LED CodeGraph terminal assistant — builds if needed, runs in local mode (no LLM required)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$CodegraphCli = Join-Path $ProjectRoot "..\codegraph\dist\bin\codegraph.js"

if (-not (Test-Path $CodegraphCli)) {
    Write-Host "Building CodeGraph..." -ForegroundColor Cyan
    Push-Location (Join-Path $ProjectRoot "..\codegraph")
    npm install --silent 2>$null
    npx tsc
    npm run copy-assets
    Pop-Location
}

node $CodegraphCli chat $ProjectRoot --init @args
