import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient information about the caller for the duration of one request or job.
 *
 * Carried in AsyncLocalStorage rather than threaded through every method
 * signature, so that the audit interceptor, the soft-delete extension and the
 * asset-history writer can all record *who* and *from where* without every
 * service having to pass it along.
 */
export interface RequestContext {
  requestId: string;
  userId: string | null;
  userName: string;
  userEmail: string | null;
  roleKeys: string[];
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
  /** Set for background work (sync run, nightly backup) that has no HTTP caller. */
  systemJob?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const SYSTEM_CONTEXT: RequestContext = {
  requestId: 'system',
  userId: null,
  userName: 'System',
  userEmail: null,
  roleKeys: [],
  ipAddress: null,
  userAgent: null,
  sessionId: null,
  systemJob: 'system',
};

export const RequestContextStore = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /** Runs a background job under a named system identity. */
  runAsSystem<T>(jobName: string, fn: () => T): T {
    return storage.run({ ...SYSTEM_CONTEXT, requestId: `job:${jobName}`, systemJob: jobName, userName: `System (${jobName})` }, fn);
  },

  get(): RequestContext {
    return storage.getStore() ?? SYSTEM_CONTEXT;
  },

  /** Null when called outside any request - used to detect unattributed writes. */
  peek(): RequestContext | undefined {
    return storage.getStore();
  },

  actorId(): string | null {
    return storage.getStore()?.userId ?? null;
  },
};
