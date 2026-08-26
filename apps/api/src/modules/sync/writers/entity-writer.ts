import { Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface WriteContext {
  runId: string;
  sourceRef: string;
  organizationId: string;
  defaultBranchId: string | null;
  actorUserId: string | null;
}

export interface ExistingRecord {
  id: string;
  label: string;
  /** Current values for the fields this import would set. */
  snapshot: Record<string, unknown>;
  /** Who last changed it, and when - used for conflict detection. */
  updatedById: string | null;
  updatedAt: Date;
}

/**
 * Turns one normalised row into a master record.
 *
 * Every writer must obey three rules:
 *   1. never delete or deactivate anything;
 *   2. never overwrite a field a human edited more recently than the last
 *      successful sync - report a conflict instead;
 *   3. record provenance so any row can be traced back to its source.
 */
export interface EntityWriter {
  /** Matches SyncSource.targetEntity. */
  readonly entity: string;

  /** Field names that make a good default dedupe key for this entity. */
  readonly defaultDedupeKeys: string[];

  /** Human-readable validation errors. An empty array means the row is usable. */
  validate(row: Record<string, unknown>): string[];

  /** Stable identity for the row, e.g. the employee code. Null = unusable. */
  dedupeKey(row: Record<string, unknown>, keys: string[]): string | null;

  findExisting(tx: Tx, dedupeKey: string, ctx: WriteContext): Promise<ExistingRecord | null>;

  create(tx: Tx, row: Record<string, unknown>, ctx: WriteContext): Promise<{ id: string; label: string }>;

  update(
    tx: Tx,
    existing: ExistingRecord,
    row: Record<string, unknown>,
    ctx: WriteContext,
  ): Promise<{ id: string; label: string; changed: string[] }>;
}

/** Builds a dedupe key from one or more normalised fields. */
export function buildDedupeKey(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  const parts = keys.map((k) => {
    const v = row[k];
    return v === null || v === undefined ? '' : String(v).trim().toLowerCase();
  });
  if (parts.every((p) => p === '')) return null;
  return parts.join('|');
}

/**
 * Fields the import is allowed to change on an existing row, given what a
 * human may have edited since. Returns the subset that is safe to write plus
 * the fields that would clash.
 */
export function reconcile(
  incoming: Record<string, unknown>,
  existing: ExistingRecord,
  lastSyncAt: Date | null,
  humanEditWins: boolean,
): { safe: Record<string, unknown>; conflicts: string[] } {
  const safe: Record<string, unknown> = {};
  const conflicts: string[] = [];

  // Was this row touched by a person (not the sync job) since the last import?
  const editedByHuman =
    humanEditWins &&
    existing.updatedById !== null &&
    (lastSyncAt === null || existing.updatedAt > lastSyncAt);

  for (const [field, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || value === '') continue;

    const current = existing.snapshot[field];
    const same =
      current instanceof Date && value instanceof Date
        ? current.getTime() === value.getTime()
        : String(current ?? '') === String(value ?? '');

    if (same) continue;

    if (editedByHuman && current !== null && current !== undefined && current !== '') {
      conflicts.push(field);
      continue;
    }
    safe[field] = value;
  }

  return { safe, conflicts };
}
