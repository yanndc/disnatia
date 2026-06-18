# Wrapper pour exécuter les diagnostics avec NODE_TLS_REJECT_UNAUTHORIZED=0
param(
    [string]$Script = "diagnose-session-vs-import.ts",
    [switch]$ByOwner
)

if ($ByOwner) {
    $Script = "diagnose-session-by-owner.ts"
}

$scriptPath = "scripts/$Script"

if (-not (Test-Path $scriptPath)) {
    Write-Host "Script not found: $scriptPath" -ForegroundColor Red
    exit 1
}

Write-Host "Running diagnostic: $Script" -ForegroundColor Cyan
Write-Host "⚠️  TLS verification disabled for local development" -ForegroundColor Yellow
Write-Host ""

$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
npx tsx $scriptPath
