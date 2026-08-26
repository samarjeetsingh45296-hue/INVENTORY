import { z } from 'zod';

// --------------------------------------------------------------- paging ----

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
  /** Admin-only: include soft-deleted rows in the result. */
  includeArchived: z.coerce.boolean().default(false),
});

export type Pagination = z.infer<typeof paginationSchema>;

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ------------------------------------------------------------ principal ----

/** The authenticated caller, attached to every request by the JWT guard. */
export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  employeeId: string | null;
  roleKeys: string[];
  permissions: string[];
  /** Empty array = unrestricted across every branch. */
  branchScope: string[];
  mfaVerified: boolean;
  sessionId: string;
}

// ----------------------------------------------------------------- sync ----

export const syncTriggerSchema = z.object({
  sourceId: z.string().uuid(),
  /** Report what would change without writing anything. */
  dryRun: z.boolean().default(false),
  /** Required to proceed when a run exceeds the large-change threshold. */
  confirmationToken: z.string().optional(),
});

export interface SyncPreview {
  runId: string;
  sourceName: string;
  rowsRead: number;
  willInsert: number;
  willUpdate: number;
  unchanged: number;
  duplicates: number;
  invalid: number;
  conflicts: number;
  /** Present when the run needs confirming before it may apply. */
  confirmationToken?: string;
  sampleIssues: Array<{ rowNumber: number; message: string }>;
}

// ---------------------------------------------------------------- audit ----

export interface AuditEntryView {
  id: string;
  action: string;
  entityType: string;
  entityLabel: string | null;
  userName: string;
  ipAddress: string | null;
  changedFields: string[];
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
  details?: unknown;
}
