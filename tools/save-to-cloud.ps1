# ---------------------------------------------------------------------------
#  Puts the inventory data safely in the cloud.
#
#  Run tools\save-to-cloud.cmd and paste ONE connection string. The tool
#  recognises which service it came from and does the right thing:
#
#    mongodb+srv://...   (MongoDB Atlas)
#        -> pushes the structured export - all seven collections - to Atlas.
#           Re-run any time to refresh the cloud copy. The website keeps
#           running on PostgreSQL; Atlas holds the cloud copy of the data.
#
#    postgresql://...    (Neon / Supabase)
#        -> moves the LIVE database to the cloud: after it, every change made
#           on the website is stored in the cloud, not on this laptop.
#
#  Where to get a string: docs\CLOUD-DATABASE.md walks both sign-ups.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:APPDATA\npm"

Write-Host ""
Write-Host "Paste the cloud connection string (Atlas 'mongodb+srv://...' or Neon 'postgresql://...')" -ForegroundColor Cyan
$uri = Read-Host "Connection string"

if ($uri -match '^mongodb(\+srv)?://') {
  if ($uri -match 'localhost|127\.0\.0\.1') {
    Write-Host "That is the local MongoDB, not the cloud. Nothing was done." -ForegroundColor Red; exit 1
  }
  Write-Host "`nMongoDB Atlas string recognised - pushing the structured export..." -ForegroundColor Cyan
  Set-Location (Join-Path $repo 'apps\api')
  & "$env:APPDATA\npm\pnpm.cmd" export:mongo -- --uri $uri
  if ($LASTEXITCODE -ne 0) { Write-Host "Export failed - see above. Nothing was saved." -ForegroundColor Red; exit 1 }

  # Remember the destination so a plain `pnpm export:mongo` refreshes the
  # cloud from now on.
  $envFile = Join-Path $repo '.env'
  $content = (Get-Content $envFile -Raw) -replace "(?m)^MONGODB_URI=.*`r?`n?", ''
  Set-Content -Path $envFile -Value ($content.TrimEnd() + "`nMONGODB_URI=`"$uri`"`n") -Encoding utf8 -NoNewline
  Write-Host "`nDone. The data is in Atlas, and future export:mongo runs refresh it automatically." -ForegroundColor Green
  Write-Host "To refresh after changes:  tools\save-to-cloud.cmd  (paste the same string) or pnpm export:mongo"
}
elseif ($uri -match '^postgres(ql)?://') {
  Write-Host "`nPostgreSQL string recognised - handing over to the live-database move..." -ForegroundColor Cyan
  Write-Host "(this moves the website's own database to the cloud)"
  # Feed the string straight into the existing, self-verifying migration.
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'move-database-to-cloud.ps1') -ConnectionString $uri
  exit $LASTEXITCODE
}
else {
  Write-Host "That does not look like an Atlas or PostgreSQL connection string. Nothing was done." -ForegroundColor Red
  exit 1
}
