# Build status

An honest account of what exists in this repository, written so nobody has to
discover the gaps by running into them.

The system **builds, migrates, seeds and runs**. It was brought up end to end on
Windows against PostgreSQL 16 and Node 24: both apps typecheck clean, the
schema migrates, the seed populates roles and permissions, and signing in
through the browser reaches a working dashboard.

## Verified by running it

| Check | Result |
|---|---|
| `prisma validate` | schema valid |
| `prisma migrate deploy` | 46 tables, 28 enums created |
| Manual SQL (triggers, actor FKs, partial indexes) | all 3 files applied |
| `tsc --noEmit` on the API | clean |
| `tsc --noEmit` on the web app | clean |
| Seed | 83 permissions, 5 roles, 2 branches, 13 categories, 13 sync sources |
| Append-only trigger: `UPDATE audit_logs` | refused by the database |
| Append-only trigger: `DELETE audit_logs` | refused by the database |
| One-active-allocation partial unique indexes | present (assets, lockers, CUG) |
| Actor foreign keys | 25 constraints present |
| Login through the browser | reaches the dashboard |
| `GET /health/ready` | database up |

## Bugs found and fixed while bringing it up

1. **`prisma/migrations/manual/` broke `migrate`** - Prisma treats every folder
   under `migrations/` as a migration. Moved to `prisma/sql/`.
2. **`psql` rejected Prisma's connection URL** - the `?schema=public` parameter
   is Prisma-only. The runner now strips unsupported parameters and translates
   a non-public schema into a `search_path`.
3. **`this.$on is not a function` on boot** - Prisma's `$extends` returns a
   Proxy over `PrismaService`, so Nest called the lifecycle hooks twice, and an
   extended client has no `$on`/`$connect`. The hooks now no-op on the proxy.
4. **MFA bootstrap deadlock** - with `SUPER_ADMIN` in `MFA_REQUIRED_ROLES`, a
   fresh deployment could never sign in: login demanded a second factor, and
   enrolling one demanded a session. Login now returns a short-lived token that
   unlocks only the enrolment endpoints.
5. **Audit trail said "Anonymous" for every sign-in** - the request-context
   scope opens before authentication, so no user was attached yet. `AuditService`
   now accepts an explicit actor and login supplies it.
6. **Every page rendered completely unstyled** - the worst kind of bug,
   because nothing errored. Next resolves `postcss.config.mjs` relative to the
   project directory, but the `tailwindcss` plugin resolves *its* config
   relative to `process.cwd()`. Launched as `next dev apps/web` from the repo
   root, Tailwind found no config at the root, fell back to its defaults with
   `content: []`, and emitted a stylesheet with the preflight reset and not one
   utility class - 12KB of CSS that looked plausible and styled nothing. Fixed
   twice over: `postcss.config.mjs` now names the config by absolute path, and
   `tailwind.config.ts` anchors its content globs to `__dirname` instead of the
   working directory. Correct output is 27KB.
7. **`nest build` emitted `dist/src/main.js`, not `dist/main.js`** - `rootDir`
   was `.` and the build included `prisma/` and `scripts/`, pushing the output
   down a level, so both `package.json`'s `start` script and the Dockerfile
   `CMD` pointed at a path that could never exist. `rootDir` is now `src`; the
   seed and CLI scripts run through ts-node and do not need compiling.
8. **The CLI scripts could not find `DATABASE_URL`** - they run outside Nest, so
   `ConfigModule` never loads, and `dotenv` is not resolvable from `apps/api`
   under pnpm's strict layout. Added a small dependency-free `load-env.ts`.
9. Assorted type errors: a non-generic `fail()` in the transform pipeline,
   `Record<string, unknown>` where Prisma wants `InputJsonValue`, a spread of
   `never`, a branded `randomUUID()` return type, a `rootDir` violation from the
   shared package, and a missing `baseUrl` that broke every `@/*` import in the
   web app.

## Complete

- **Data model** - 46 models, 28 enums, covering organisations, branches, a
  location tree, departments, designations, employees, users, roles,
  permissions, assets, categories, vendors, purchase orders, allocations, asset
  events, repairs, damage reports, headphones, workstations, lockers, CUG
  connections, consumable stock, requests, approvals, physical audits,
  attachments, audit logs, sync sources/mappings/runs/rows, backups,
  notifications and settings.
- **Soft-delete guarantee** - Prisma extension refusing hard deletes; archived
  rows filtered from reads unless explicitly requested.
- **Append-only history** - database triggers on six history tables.
- **RBAC** - 83 permissions, 5 roles, deny-by-default guard.
- **Auth** - argon2id, refresh-token rotation with reuse detection, TOTP MFA,
  recovery codes, lockout, login history.
- **Audit trail** - field-level diffs, actor, IP, user agent, request id;
  read-only over HTTP.
- **Sync engine** - Google Sheets and Excel/CSV adapters, editable column
  mapping, auto-match, value transforms, dedupe, conflict detection, dry-run
  preview, large-change confirmation, permanent raw-row archive, manual /
  scheduled / one-time-migration modes, disconnect and reconnect.
- **Backups** - nightly and weekly pg_dump with retention and pruning, manual
  backup, Excel workbook export, per-dataset CSV export, integrity check.
- **Allocations** - issue, return, transfer, with the full custody chain and
  asset timeline written transactionally.
- **Realtime** - Socket.io gateway with room-based authorisation.
- **Frontend** - login with MFA, dashboard, inventory, employees, sheet sync
  (including the column mapping editor and run reports), audit trail, backups.

## Partial

| Area | What is there | What is missing |
|---|---|---|
| Approval workflow | Schema, request creation from asset archive, approval steps | The service that walks the steps and applies an approved payload |
| Sync writers | `employee` and `asset` | `locker`, `cug`, `workstation`, `stock` writers (same interface, mechanical to add) |
| Employees | List, detail, history, create, update, archive, restore | UI for create and edit |
| Assets | Full service and API | UI for create and edit; QR label generation |
| Users and roles | Schema, seeding, guards, JWT resolution | Admin CRUD endpoints and screens |

## Not started

- Repairs module (schema exists, no service, controller or UI)
- Stock module (schema exists)
- Lockers, CUG and workspace modules (schema exists)
- Physical audit / QR scanning (schema exists)
- Notifications delivery (schema exists; email transport configured but unused)
- File attachments upload and storage driver
- Reports and analytics beyond the dashboard summary
- Tests - there are none

## Known risks

1. **Timestamps are `TIMESTAMP(3)` without a time zone.** Prisma writes UTC,
   but the column's `DEFAULT CURRENT_TIMESTAMP` writes the server's *local*
   time. Rows created by Prisma are consistent, but anything inserted by raw
   SQL picks up local time and reads back 5h30m out in IST. For an audit trail
   that is meant to be authoritative - and for the multi-office requirement -
   these columns should be `@db.Timestamptz(3)`. Fixing it is a mechanical
   schema-wide change plus one migration, and is worth doing before real data
   lands.
2. **The Prisma client extension** used for soft-delete guarding relies on
   `$allOperations`, which requires Prisma 5.16+. The pinned version (5.22) is
   fine, but if you downgrade, this breaks.
3. **Column mappings are unconfigured.** The sheets could not be read from
   outside the university Google account, so every source is registered with a
   guessed `targetEntity` of `asset` and no mapping. An admin must confirm the
   entity and map the columns for each tab before its first import. Doing this
   through the UI is the intended workflow, not a workaround.
4. **`pg_dump` must be on the PATH** of whatever runs the API, or backups fail.
   The API Docker image installs it; a bare-metal deployment must too.
