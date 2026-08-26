# Build status

An honest account of what exists in this repository, written so nobody has to
discover the gaps by running into them.

**Nothing here has been compiled or run.** The machine this was written on has
no Node.js, npm, Docker or PostgreSQL. Static verification was done instead:
schema structure, role/permission consistency, and import resolution.

## Verified statically

| Check | Result |
|---|---|
| Prisma schema: duplicate models | none |
| Prisma schema: missing back-relations | none |
| Prisma schema: unknown field types | none |
| Prisma schema: ambiguous unnamed relations | none |
| Role matrix vs 83-permission catalogue | consistent, no contradictions |
| Relative imports across API source files | all resolve |
| Relative imports across web source files | all resolve |
| Non-ASCII characters in source | none |

Not verified, because it needs a toolchain: TypeScript compilation, Prisma
client generation, runtime behaviour, and the SQL in `migrations/manual`
actually executing against a live PostgreSQL instance.

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

1. **First build will surface type errors.** Nothing was compiled. Budget an
   hour for this.
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
