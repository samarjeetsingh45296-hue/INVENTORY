/**
 * Socket.io event names shared by the API gateway and the web client.
 * Clients join rooms so a user only receives what they are allowed to see.
 */

export const WS_EVENTS = {
  // server -> client
  ASSET_CREATED: 'asset.created',
  ASSET_UPDATED: 'asset.updated',
  ASSET_ARCHIVED: 'asset.archived',
  ASSET_RESTORED: 'asset.restored',
  ALLOCATION_CREATED: 'allocation.created',
  ALLOCATION_RETURNED: 'allocation.returned',
  ALLOCATION_TRANSFERRED: 'allocation.transferred',
  REPAIR_CREATED: 'repair.created',
  REPAIR_UPDATED: 'repair.updated',
  EMPLOYEE_UPDATED: 'employee.updated',
  STOCK_CHANGED: 'stock.changed',
  APPROVAL_PENDING: 'approval.pending',
  APPROVAL_DECIDED: 'approval.decided',
  SYNC_PROGRESS: 'sync.progress',
  SYNC_COMPLETED: 'sync.completed',
  BACKUP_COMPLETED: 'backup.completed',
  NOTIFICATION: 'notification',
  DASHBOARD_TICK: 'dashboard.tick',

  // client -> server
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export const WS_ROOMS = {
  /** Everything happening in one branch. */
  branch: (branchId: string) => `branch:${branchId}`,
  /** A single asset's timeline, for the asset detail screen. */
  asset: (assetId: string) => `asset:${assetId}`,
  /** Private channel for one user's notifications. */
  user: (userId: string) => `user:${userId}`,
  /** Anyone allowed to see admin-level activity. */
  admin: () => 'admin',
  /** Live progress of one sync run. */
  syncRun: (runId: string) => `sync:${runId}`,
} as const;

export interface RealtimePayload<T = unknown> {
  event: WsEvent;
  entityType: string;
  entityId: string;
  branchId?: string | null;
  actorName?: string;
  at: string;
  data: T;
}
