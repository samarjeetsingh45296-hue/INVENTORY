# Inventory Suite

Asset and inventory management for the Parul University campus and the Central
Contact Center.

**The governing rule of this system:** the PostgreSQL database is the permanent
source of truth. Google Sheets are an *import surface* only. If every
spreadsheet linked in the brief were deleted tomorrow, this application would
keep working with no loss of employees, assets, allocations, repairs, history,
or audit records.

---

## Status

This repository contains the full data model plus a working backend and
frontend for the core of the system. It **builds, migrates, seeds and runs**:
brought up end to end against PostgreSQL 16 on Node 24, with both apps
type-checking clean and sign-in reaching a working dashboard.

The database-level guarantees are not just claimed, they are tested: the
append-only triggers demonstrably refuse `UPDATE` and `DELETE` on the audit
trail, the partial unique indexes enforcing one active allocation per asset are
in place, and 25 actor foreign keys are installed.

See [docs/STATUS.md](docs/STATUS.md) for a precise, module-by-module account of
what is built, what is partial, and what is not started.

---

## Getting it running

### 1. Install the prerequisites

None of these are currently on this machine:

| Tool | Version | Why |
|---|---|---|
| Node.js | 20.11+ | runs the API and the web app |
| pnpm | 9+ | workspace package manager (`npm i -g pnpm`) |
| PostgreSQL | 16 | the master database |
| Redis | 7 | scheduled jobs and cache |
| Docker Desktop | latest | optional, but supplies Postgres and Redis in one step |

The quickest path on Windows is Docker Desktop plus Node.js; the compose file
then provides everything else.

### 2. Configure

```bash
cp .env.example .env
```

Then edit `.env`. At minimum set `DATABASE_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET` and `ENCRYPTION_KEY`. Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

`ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes). The API refuses
to start on invalid configuration rather than failing later.

### 3. Start the database

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
```

### 4. Create the schema

```bash
pnpm install
pnpm db:generate
pnpm --filter @inventory/api prisma migrate dev --name init
pnpm --filter @inventory/api prisma:manual
pnpm db:seed
```

`prisma:manual` applies the hand-written SQL that Prisma cannot express: the
append-only triggers on the audit and history tables, the actor foreign keys,
and the partial unique index that makes "one active allocation per asset" a
database guarantee rather than a convention.

The seed prints a generated Super Admin password **once**. Write it down.

### 5. Run it

```bash
pnpm dev
```

- Web app: http://localhost:3000
- API: http://localhost:4000/api/v1
- API docs: http://localhost:4000/api/v1/docs

---

## Getting your sheet data in

The tabs across your two workbooks are already registered as sync sources by
the seed, so they appear on the **Sheet Sync** screen the moment you sign in.
Their column mappings are empty until you set them, and nothing imports until
you do.

There are two routes in, and they end in exactly the same place.

### Route A - upload the files (no Google account needed)

1. In Google Sheets: **File > Download > Microsoft Excel (.xlsx)** for each tab.
2. Sheet Sync > **Map columns** > **Auto-match columns**, correct anything
   wrong, then **Save mapping**.
3. **Preview** - writes nothing, and tells you exactly what would happen.
4. **Sync now**.

### Route B - connect the Sheets API (enables scheduled sync)

1. Create a Google Cloud service account and enable the Google Sheets API.
2. Download the JSON key to `secrets/google-service-account.json`.
3. Share each spreadsheet with the service account email address as **Viewer**.
   Viewer is all the system ever asks for: it requests the read-only scope, so
   it physically cannot modify your sheets.
4. Point `GOOGLE_SERVICE_ACCOUNT_JSON` at the key file and restart the API.
5. Map columns and sync as above.

### The three sync modes

| Mode | What it does |
|---|---|
| **Manual** | You press "Sync now". New rows inserted, changed rows updated. |
| **Scheduled** | Hourly, six-hourly or daily, configured per source. |
| **One-time migration** | Takes a full backup, imports once, disconnects the sheet permanently. |

**Disconnect** severs the link without touching a single imported record. The
screen tells you exactly how many employees and assets remain afterwards,
because that is the whole point.

---

## What protects your data

These are enforced in the database, not only in application code, so they hold
even against a bug or a compromised application credential.

- **Nothing is hard-deleted.** The Prisma client refuses `delete` and
  `deleteMany` on every table with a `deletedAt` column. Deleting means
  archiving; the row, its history and its audit trail stay.
- **History cannot be rewritten.** `audit_logs`, `asset_events`, `repair_logs`,
  `stock_transactions`, `login_history` and `sync_rows` carry triggers that
  reject `UPDATE` and `DELETE` outright.
- **Sync never deletes.** A row disappearing from a sheet is a source outage,
  not a business event. The engine only ever inserts and updates.
- **The sheet never overwrites human work.** If somebody edited a field in the
  website after the last import and the sheet disagrees, the import reports a
  conflict and keeps what the website has.
- **Every raw sheet row is archived.** `sync_rows` keeps the verbatim contents
  of every row ever read, so the original data survives the spreadsheet.
- **Large changes pause.** A run touching more than `SYNC_MAX_ROWS_PER_RUN`
  rows stops and asks a human to confirm rather than applying blindly.
- **Backups are verified.** Every dump records a row count per table, so silent
  loss shows up as a falling count between two consecutive backups.

---

## Repository layout

```
apps/
  api/                   NestJS API
    prisma/
      schema.prisma      46 models, 28 enums - the master data model
      sql/               append-only triggers, actor FKs, partial indexes
      seed.ts            permissions, roles, org, categories, sync sources
    src/
      common/            guards, interceptors, request context, Prisma client
      modules/
        auth/            JWT + refresh rotation + TOTP MFA + lockout
        sync/            the Google Sheets / Excel import engine
        backup/          pg_dump, retention, Excel and CSV exports
        assets/          inventory, archive-by-approval
        allocations/     issue, return, transfer, permanent custody chain
        employees/       people and their equipment
        audit/           read-only audit trail
        realtime/        Socket.io gateway
        dashboard/       live figures
  web/                   Next.js 14 App Router frontend
packages/
  shared/                permission catalogue, role matrix, socket events
infra/docker/            compose file and Dockerfiles
docs/                    architecture, runbook, status
data/raw/                drop downloaded .xlsx files here (git-ignored)
```

---

## Roles

Five roles, exactly as specified, defined in
[packages/shared/src/roles.ts](packages/shared/src/roles.ts). Each carries an
explicit `mustNotHave` list encoding the "Cannot" rules from the brief, so a
future permission change cannot silently widen a role.

| Role | Can | Cannot |
|---|---|---|
| Super Admin | everything | - |
| HR Admin | assets, allocations, employees, inventory | delete system records, touch the audit trail, manage users |
| Inventory Manager | inventory, repairs, stock | anything under user management |
| Team Leader | view team assets, request, report damage | modify inventory |
| Employee | view own assets, raise requests | edit anything |

Authorisation denies by default: an endpoint that forgets to declare its
permissions is refused, not opened.

---

## Documentation

- [docs/STATUS.md](docs/STATUS.md) - what is built and what is not
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - how the pieces fit together
- [docs/RUNBOOK.md](docs/RUNBOOK.md) - backups, restore, incident procedures
