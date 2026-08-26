import { Prisma } from '@prisma/client';
import { RequestContextStore } from '../context/request-context';

/**
 * Models that carry a `deletedAt` column, computed from the generated schema
 * at runtime so this list can never drift out of sync with the datamodel.
 */
export const SOFT_DELETE_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'deletedAt'))
    .map((m) => m.name),
);

/**
 * Models that are pure history. Nothing may ever update or delete them.
 * The database enforces this too (prisma/sql/02_append_only.sql);
 * this check simply produces a readable error before the query is sent.
 */
export const APPEND_ONLY_MODELS: ReadonlySet<string> = new Set([
  'AuditLog',
  'AssetEvent',
  'RepairLog',
  'StockTransaction',
  'LoginHistory',
  'SyncRow',
]);

/** Opt out of automatic archived-row filtering for one query. */
export const INCLUDE_ARCHIVED = { deletedAt: undefined } as const;

const READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

type AnyArgs = { where?: Record<string, unknown> } & Record<string, unknown>;

function hasExplicitDeletedFilter(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false;
  const w = where as Record<string, unknown>;
  if ('deletedAt' in w) return true;
  for (const key of ['AND', 'OR', 'NOT'] as const) {
    const branch = w[key];
    if (Array.isArray(branch) && branch.some(hasExplicitDeletedFilter)) return true;
    if (branch && !Array.isArray(branch) && hasExplicitDeletedFilter(branch)) return true;
  }
  return false;
}

/**
 * Wraps a PrismaClient so that:
 *   1. hard deletes on soft-deletable models are refused outright;
 *   2. reads exclude archived rows unless the caller opts in explicitly;
 *   3. append-only tables reject update/delete before hitting the database.
 *
 * This is the code-level half of the "no data is ever lost" guarantee. The
 * database triggers are the half that survives a compromised application.
 */
export function applySoftDeleteExtension<T extends object>(client: T): T {
  return (client as any).$extends({
    name: 'soft-delete-guard',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: AnyArgs;
          query: (a: AnyArgs) => Promise<unknown>;
        }) {
          if (APPEND_ONLY_MODELS.has(model) &&
              (operation.startsWith('update') || operation.startsWith('delete') || operation === 'upsert')) {
            throw new Error(
              `${model} is an append-only history table; ${operation} is not permitted. ` +
                'Write a new row instead of modifying the record of what happened.',
            );
          }

          if (SOFT_DELETE_MODELS.has(model) && (operation === 'delete' || operation === 'deleteMany')) {
            const ctx = RequestContextStore.get();
            throw new Error(
              `Hard delete of ${model} is refused (attempted by ${ctx.userName}). ` +
                'Use the archive/soft-delete path so history is preserved. Permanent ' +
                'removal is available only to a Super Admin through PurgeService.',
            );
          }

          if (SOFT_DELETE_MODELS.has(model) && READ_OPS.has(operation)) {
            if (!hasExplicitDeletedFilter(args?.where)) {
              args = { ...args, where: { ...(args?.where ?? {}), deletedAt: null } };
            }
          }

          return query(args);
        },
      },
    },
  }) as T;
}
