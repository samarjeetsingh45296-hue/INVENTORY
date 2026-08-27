# ---------------------------------------------------------------------------
#  Moves the Inventory Suite database into a cloud PostgreSQL.
#
#  Run:  right-click > Run with PowerShell   (or from tools\move-database-to-cloud.cmd)
#
#  You will be asked for the cloud connection string. Get one free from
#  https://neon.tech - see docs\CLOUD-DATABASE.md for the exact clicks.
#
#  What it does, in order - and it stops at the first failure:
#    1. tests the cloud connection
#    2. dumps the laptop database (this dump is also kept as a backup)
#    3. restores everything into the cloud database
#    4. re-applies the protections Prisma cannot express (append-only
#       triggers, actor FKs, partial unique indexes)
#    5. compares row counts table by table - laptop vs cloud
#    6. only if they match, points .env at the cloud (old line kept, commented)
#
#  The laptop database is never modified or deleted. It stays as a fallback.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$pg    = "C:\Program Files\PostgreSQL\16\bin"
$local = "postgresql://postgres:postgres@localhost:5432/inventory"

Write-Host ""
Write-Host "Paste the CLOUD connection string (from Neon / Supabase)." -ForegroundColor Cyan
Write-Host "It looks like: postgresql://user:password@ep-xxx.aws.neon.tech/dbname?sslmode=require"
$cloud = Read-Host "Connection string"
if (-not $cloud -or $cloud -notmatch '^postgres(ql)?://') {
  Write-Host "That does not look like a PostgreSQL connection string. Nothing was done." -ForegroundColor Red
  exit 1
}
if ($cloud -match 'localhost|127\.0\.0\.1') {
  Write-Host "That points at this laptop, not the cloud. Nothing was done." -ForegroundColor Red
  exit 1
}

Write-Host "`n[1/6] Testing the cloud connection..." -ForegroundColor Cyan
& "$pg\psql.exe" $cloud -tAc "SELECT version();" | Out-Null
Write-Host "      connected."

Write-Host "[2/6] Dumping the laptop database..." -ForegroundColor Cyan
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dump  = Join-Path $repo "backups\pre-cloud-move-$stamp.dump"
New-Item -ItemType Directory -Force (Join-Path $repo 'backups') | Out-Null
& "$pg\pg_dump.exe" --format=custom --no-owner --no-privileges --file $dump $local
Write-Host "      $dump ($([math]::Round((Get-Item $dump).Length/1KB)) KB)"

Write-Host "[3/6] Restoring into the cloud (a few minutes on a free tier)..." -ForegroundColor Cyan
# Extensions first - the dump assumes they exist.
& "$pg\psql.exe" $cloud -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;" | Out-Null
& "$pg\pg_restore.exe" --clean --if-exists --no-owner --no-privileges --dbname $cloud $dump 2>$null
Write-Host "      restored."

Write-Host "[4/6] Re-applying triggers, actor FKs and unique indexes..." -ForegroundColor Cyan
Get-ChildItem "apps\api\prisma\sql\*.sql" | Sort-Object Name | ForEach-Object {
  & "$pg\psql.exe" $cloud -q -v ON_ERROR_STOP=1 -f $_.FullName 2>$null | Out-Null
  Write-Host "      $($_.Name) applied"
}

Write-Host "[5/6] Comparing row counts, laptop vs cloud..." -ForegroundColor Cyan
$q = "SELECT relname || '=' || n_live_tup FROM pg_stat_user_tables WHERE relname NOT LIKE '_prisma%' ORDER BY relname;"
& "$pg\psql.exe" $cloud -tAc "ANALYZE;" | Out-Null
$a = (& "$pg\psql.exe" $local -tAc $q) -join "`n"
$b = (& "$pg\psql.exe" $cloud -tAc $q) -join "`n"
if ($a -ne $b) {
  Write-Host "      MISMATCH - .env was NOT changed; the laptop stays in charge." -ForegroundColor Red
  Write-Host "      Differences:" -ForegroundColor Red
  Compare-Object ($a -split "`n") ($b -split "`n") | Format-Table -AutoSize
  exit 1
}
Write-Host "      every table matches."

Write-Host "[6/6] Pointing .env at the cloud..." -ForegroundColor Cyan
$envFile = Join-Path $repo '.env'
$content = Get-Content $envFile -Raw
$content = $content -replace '(?m)^DATABASE_URL=', '# moved to cloud - old value kept:  # DATABASE_URL='
$content = $content.TrimEnd() + "`nDATABASE_URL=`"$cloud`"`n"
Set-Content -Path $envFile -Value $content -Encoding utf8 -NoNewline

Write-Host ""
Write-Host "Done. From the next start, everything reads and writes the CLOUD." -ForegroundColor Green
Write-Host "Restart now:  tools\stop-inventory.cmd  then  tools\start-inventory.cmd"
Write-Host "The laptop database was left untouched as a fallback, and the dump is in backups\."
