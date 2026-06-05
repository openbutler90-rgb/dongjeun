$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

$serverTs = Join-Path $ProjectRoot "server.ts"
$serverCjs = Join-Path $ProjectRoot "dist\server.cjs"

if (-not (Test-Path -LiteralPath $serverCjs) -or (Get-Item $serverTs).LastWriteTime -gt (Get-Item $serverCjs).LastWriteTime) {
  npm run build
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Start-Process -FilePath "npm.cmd" -ArgumentList "run","desktop:open" -WindowStyle Hidden
exit 0
