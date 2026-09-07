# Runbook

Operational procedures. Written for whoever is on call, not for whoever wrote
the code.

## Backups

### The MongoDB copy (the standing backup)

Every record - employees, assets, seats with their kit, CUG lines, lockers,
repairs, PVR cards - plus the sheets' rows verbatim, is mirrored into MongoDB
(database `inventory`, one collection per entity):

- every night at 01:30 IST (`MONGO_MIRROR_CRON`), and two minutes after the
  API starts;
- by hand: `pnpm --filter @inventory/api mirror:mongo`
  (`-- --uri "mongodb+srv://..."` points it at Atlas for an off-machine copy).

Each run writes a `BACKUP` line to Change History saying how many documents
it holds, or `MONGODB COPY FAILED` with the reason. There is no screen for
this on the website; Change History is where to look.

### Putting seats back

If seats are deleted or archived on the website, restore them from the copy:

```bash
pnpm --filter @inventory/api seats:restore -- --dry-run     # report only
pnpm --filter @inventory/api seats:restore                  # every seat missing here
pnpm --filter @inventory/api seats:restore -- --seat 4E173  # one seat
```

A seat comes back with its wing, process, chair and gaps; its equipment is
un-archived and re-allocated, or recreated with the same tag, model and
serial if it is gone. Seats that are present and complete are untouched.
Nothing is ever removed.

### What else runs automatically

| Job | Schedule (default) | Retention |
|---|---|---|
| Nightly database dump | 01:00 IST | 90 days |
| Weekly archive | 03:00 Sunday IST | 52 weeks |
| Integrity check | 04:30 IST | - |

Schedules come from `BACKUP_DAILY_CRON` and `BACKUP_WEEKLY_CRON`. These
dumps need `PG_DUMP_PATH` to point at a working `pg_dump.exe`; a zero-byte
`.dump` file in `backups/` means it does not.

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
