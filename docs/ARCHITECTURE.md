# Architecture

## The one rule everything follows

> The database is the master. Google Sheets are an import surface.

Every design decision below exists to make that true in practice, not just in
a document. The test is simple: delete every spreadsheet and confirm nothing
about the running system changes.

## Shape

```
Browser (Next.js 14)
    |  REST over HTTPS         WebSocket (Socket.io)
    v                          v
NestJS API  ------------------------------------
    |  Prisma (soft-delete guard extension)
    v
PostgreSQL 16          Redis 7
  master data          schedules, cache
    ^
    |  read-only, on demand
Google Sheets API  /  uploaded .xlsx and .csv
```

Nothing downstream of PostgreSQL depends on Google. The Sheets adapter is one
implementation of a `SourceAdapter` interface; the file adapter is another. The
sync engine has no idea which one it is talking to.

## Request lifecycle

1. `RequestContextInterceptor` opens an AsyncLocalStorage scope holding the
   request id, actor, IP and user agent.
2. `JwtAuthGuard` validates the access token and resolves the user's roles and
   permissions **from the database on every request**, so revoking a role takes
   effect immediately rather than when the token expires.
3. `PermissionsGuard` denies by default. A protected route with no
   `@RequirePermissions` is refused and logged as a programming error.
4. The service does its work. Anything it writes can reach the audit trail
   without the actor being threaded through every method signature, because the
   context is ambient.
5. `AllExceptionsFilter` maps errors to a consistent JSON shape and keeps
   database internals out of responses.

## Why actor columns are not Prisma relations

`createdById`, `updatedById` and `deletedById` appear on almost every table.
Modelling each as a Prisma relation would require roughly 150 back-references
on `User`, which makes the model unusable and every query slower to reason
about. They are plain `uuid` scalars, and referential integrity is added at the
database level in `migrations/manual/01_actor_fks.sql` with `ON DELETE
RESTRICT` - a user row can never be hard-deleted while history still points at
it. Business relations are always modelled properly.

## Soft delete

Two layers:

- **Application** - a Prisma client extension throws on `delete` and
  `deleteMany` for any model carrying `deletedAt`, and injects `deletedAt: null`
  into reads unless the caller explicitly opts in. Passing
  `deletedAt: undefined` in a `where` clause is the documented opt-in, used by
  the sync writers so re-importing revives an archived record rather than
  cloning it.
- **Database** - the six history tables reject `UPDATE` and `DELETE` via
  triggers. A session can only bypass this by setting
  `app.allow_history_rewrite = 'on'`, which is reserved for the documented
  restore procedure.

The application layer gives readable errors. The database layer is what
survives a compromised application credential.

## The sync engine

```
SyncSource (+ SyncColumnMapping)
    |
    v
SourceAdapter.read()  ->  headers + raw rows
    |
    v
prepareRows()   map columns, apply transforms, validate
    |
    v
applyRows()     per row, in its own transaction:
                  no dedupe key      -> INVALID
                  seen in this sheet -> DUPLICATE
                  no existing record -> create        -> IMPORTED
                  human edited since -> keep website  -> CONFLICT
                  nothing differs    ->               -> UNCHANGED
                  otherwise          -> update        -> UPDATED
    |
    v
SyncRow (permanent archive of every raw row, even on a dry run)
```

Four properties are worth calling out.

**It never deletes.** There is no code path from "row missing from sheet" to
any change in the database. That is deliberate: a missing row far more often
means a filtered view, a renamed tab or an API error than a genuine deletion.

**The database wins conflicts.** `reconcile()` compares the incoming value, the
current value, and whether a human touched the row since the last successful
sync. If they did, the sheet loses and the row is reported as a conflict for a
person to resolve. Without this, editing in the website would be pointless -
the next sync would silently undo it.

**A missing required column stops the run.** If a mapped column marked required
is no longer in the sheet, the engine refuses before writing anything, rather
than importing a column of nulls over good data.

**Every raw row is kept.** `sync_rows` stores the verbatim cell values of every
row ever read, keyed by run. This is what makes "the sheet was deleted" a
non-event: the source data is already inside the master database.

## Realtime

Socket.io, authenticated with the same access token. Rooms are the
authorisation boundary - a socket is joined to its user's private room on
connect, and may only subscribe to branch, asset or sync-run rooms. Live
updates never become a way to see data the REST API would refuse.

## Scalability

Multi-office is in the model, not bolted on later: `Organization > Branch >
Location(tree)`. A new campus, contact centre or warehouse is a row, not a
migration. `UserScope` restricts a user to specific branches; no scope rows
means unrestricted, which is how Super Admin works.

Asset subtypes (headphones, lockers, CUG SIMs, workstations) are 1:1 extension
tables on `Asset`. Every one still appears in global inventory reports and has
a lifetime history, while keeping its own typed columns. Adding a new subtype
is a table plus a category row.
