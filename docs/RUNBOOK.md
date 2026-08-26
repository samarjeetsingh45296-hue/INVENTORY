# Runbook

Operational procedures. Written for whoever is on call, not for whoever wrote
the code.

## Backups

### What runs automatically

| Job | Schedule (default) | Retention |
|---|---|---|
| Nightly database dump | 01:00 IST | 90 days |
| Weekly archive | 03:00 Sunday IST | 52 weeks |
| Integrity check | 04:30 IST | - |

Schedules come from `BACKUP_DAILY_CRON` and `BACKUP_WEEKLY_CRON`, so the window
can be moved without a redeploy.

Pruning never removes the newest 7 backups of a type regardless of retention
dates, so a wrong system clock cannot wipe every backup.

### Checking backups are healthy

Open **Backups** in the web app. Three things matter:

1. The most recent successful run is under 24 hours old.
2. `Rows captured` is not falling between consecutive backups. A drop means
   something deleted data.
3. The red banner about missing files is absent. It appears when the database
   has a backup record but the file is not on disk.

### Restoring

Restoring is destructive and is never done casually.

```bash
# 1. Take a backup of the CURRENT state first, whatever state it is in.
pg_dump --format=custom --file pre-restore.dump "$DATABASE_URL"

# 2. Stop the API so nothing writes during the restore.
docker compose -f infra/docker/docker-compose.yml stop api

# 3. Restore into a clean database.
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "$DATABASE_URL" backups/inventory-daily-<timestamp>.dump

# 4. Re-apply the manual migrations - pg_restore does not recreate triggers
#    that were added outside Prisma's migration history.
pnpm --filter @inventory/api prisma:manual

# 5. Start the API and verify.
docker compose -f infra/docker/docker-compose.yml start api
```

Step 4 is easy to forget and important: without it the append-only triggers are
gone and history is silently editable again.

### Restoring a single table

The dumps are custom-format, so you do not have to restore everything:

```bash
pg_restore --data-only --table=assets --dbname "$DATABASE_URL" backup.dump
```

## Sync incidents

### "Could not read the spreadsheet"

The Sheets API returned an error. **No data has been changed.** Everything
previously imported is still available and the site works normally.

Check, in order:

1. Is the spreadsheet still shared with the service account as Viewer? Someone
   removing that share is the most common cause.
2. Has the tab been renamed or deleted? The system resolves tabs by `gid`, so
   renaming is safe but deleting is not.
3. Is `GOOGLE_SERVICE_ACCOUNT_JSON` pointing at a file that exists inside the
   container?

If the sheet is gone for good, use **Disconnect** on that source. Nothing is
lost; the link is simply closed.

### "These required columns are not in the sheet any more"

Somebody renamed a column. Open **Map columns**, re-point the affected field at
its new header, and save. No data was written during the failed run.

### A sync reported conflicts

Expected behaviour, not an error. It means the sheet and the website disagree
about fields that a person edited in the website after the last import. The
website value was kept. Open the run report to see which rows and fields, then
either correct the sheet or accept the divergence.

### A sync is waiting for confirmation

The sheet grew past `SYNC_MAX_ROWS_PER_RUN` (default 20,000). This is the guard
against a mis-shared or duplicated sheet dumping tens of thousands of rows in
unattended. Review the preview figures, then confirm.

## Security incidents

### Suspected credential compromise

```sql
-- End every session for one user immediately.
UPDATE refresh_tokens
SET "revokedAt" = now(), "revokedReason" = 'INCIDENT'
WHERE "userId" = '<uuid>' AND "revokedAt" IS NULL;

-- Then deactivate the account (never delete it - history references it).
UPDATE users SET "isActive" = false WHERE id = '<uuid>';
```

Access tokens are short-lived (15 minutes by default) and permissions are
re-read from the database on every request, so deactivating an account takes
effect within one token lifetime at worst, and immediately for permissions.

### Refresh token reuse detected

The system does this itself: presenting an already-rotated refresh token
revokes the entire token family and writes an audit entry. If you see these,
somebody replayed a stolen token. Investigate `login_history` for that user.

### Reviewing what someone did

Everything is in the audit trail, filterable by user, action, record and date
range. It cannot be edited or deleted by anyone, including a Super Admin. For a
single record, the **History** view shows every change with old and new values.

## Health checks

| Endpoint | Meaning |
|---|---|
| `GET /api/v1/health` | process is alive |
| `GET /api/v1/health/ready` | database is reachable; use this for load balancers |

## Routine checks

**Daily** - backup succeeded, no failed sync runs, no unexpected lockouts.

**Weekly** - review `sync_runs` for repeated conflicts (a sign the sheet and
the website are being edited in parallel and one should become read-only), and
check the audit trail for unexpected sensitive actions.

**Monthly** - test a restore into a scratch database. A backup nobody has
restored is a hypothesis, not a backup.
