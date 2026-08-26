/**
 * The single source of truth for every permission in the system.
 *
 * Adding a capability means adding it here first: the seed script syncs this
 * catalogue into the `permissions` table on every deploy, and the API refuses
 * to start if a controller references a key that is not listed here.
 */

export interface PermissionDef {
  key: string;
  module: string;
  action: string;
  description: string;
  /** Sensitive permissions are always written to the audit log when used. */
  sensitive?: boolean;
}

const p = (
  key: string,
  description: string,
  sensitive = false,
): PermissionDef => {
  const [module, action] = key.split('.') as [string, string];
  return { key, module, action, description, sensitive };
};

export const PERMISSIONS: readonly PermissionDef[] = [
  // ---------------------------------------------------------------- users --
  p('user.read', 'View user accounts'),
  p('user.create', 'Create user accounts', true),
  p('user.update', 'Edit user accounts', true),
  p('user.delete', 'Deactivate (soft delete) a user account', true),
  p('user.restore', 'Restore a deactivated user account', true),
  p('user.reset_password', 'Reset the password of another user', true),
  p('user.manage_mfa', 'Reset the MFA device of another user', true),
  p('user.impersonate', 'Sign in as another user for support', true),

  // ---------------------------------------------------------------- roles --
  p('role.read', 'View roles and their permissions'),
  p('role.create', 'Create a custom role', true),
  p('role.update', 'Edit a role and its permissions', true),
  p('role.delete', 'Delete a custom role', true),
  p('role.assign', 'Assign or revoke a role for a user', true),

  // ------------------------------------------------------------ employees --
  p('employee.read', 'View employee records'),
  p('employee.read_pii', 'View sensitive employee fields such as DOB', true),
  p('employee.create', 'Add an employee'),
  p('employee.update', 'Edit an employee'),
  p('employee.delete', 'Archive an employee record', true),
  p('employee.restore', 'Restore an archived employee', true),
  p('employee.export', 'Export employee data', true),

  // --------------------------------------------------------------- assets --
  p('asset.read', 'View inventory'),
  p('asset.read_own', 'View only assets assigned to yourself'),
  p('asset.read_team', 'View assets assigned to your reporting team'),
  p('asset.create', 'Add an asset'),
  p('asset.update', 'Edit asset details'),
  p('asset.delete', 'Archive an asset (requires approval)', true),
  p('asset.restore', 'Restore an archived asset', true),
  p('asset.purge', 'Permanently remove an archived asset', true),
  p('asset.bulk_update', 'Bulk-edit assets (requires approval)', true),
  p('asset.export', 'Export inventory'),
  p('asset.print_label', 'Generate and print QR labels'),

  // ---------------------------------------------------------- allocations --
  p('allocation.read', 'View allocation records'),
  p('allocation.allocate', 'Assign an asset to a holder'),
  p('allocation.return', 'Record the return of an asset'),
  p('allocation.transfer', 'Transfer an asset between holders'),
  p('allocation.override', 'Force-close an allocation (requires approval)', true),

  // -------------------------------------------------------------- repairs --
  p('repair.read', 'View repair tickets'),
  p('repair.create', 'Raise a repair ticket'),
  p('repair.update', 'Progress a repair ticket'),
  p('repair.close', 'Close a repair ticket'),
  p('repair.manage_vendor', 'Manage repair vendors'),

  // ---------------------------------------------------------------- stock --
  p('stock.read', 'View consumable stock'),
  p('stock.receive', 'Record stock received'),
  p('stock.issue', 'Issue stock'),
  p('stock.adjust', 'Adjust stock (requires approval)', true),

  // ----------------------------------------------------------- workspaces --
  p('workspace.read', 'View seats and workspaces'),
  p('workspace.manage', 'Create and edit seats'),
  p('workspace.allocate', 'Assign a seat to an employee'),

  // ----------------------------------------------------------- locker/cug --
  p('locker.read', 'View lockers'),
  p('locker.manage', 'Create and edit lockers'),
  p('locker.allocate', 'Assign a locker'),
  p('cug.read', 'View CUG connections'),
  p('cug.manage', 'Create and edit CUG connections'),
  p('cug.allocate', 'Assign a CUG number'),

  // ------------------------------------------------------------- requests --
  p('request.read', 'View asset requests'),
  p('request.read_own', 'View your own requests'),
  p('request.create', 'Raise an asset request'),
  p('request.fulfil', 'Fulfil an approved request'),
  p('damage.report', 'Report damaged equipment'),
  p('damage.review', 'Review damage reports'),

  // ------------------------------------------------------------ approvals --
  p('approval.read', 'View pending approvals'),
  p('approval.decide_manager', 'Approve or reject at manager stage', true),
  p('approval.decide_admin', 'Approve or reject at admin stage', true),
  p('approval.decide_super', 'Approve or reject at super-admin stage', true),

  // ---------------------------------------------------------------- audit --
  p('audit.read', 'View the audit trail', true),
  p('audit.export', 'Export the audit trail', true),
  p('physical_audit.manage', 'Plan and run physical stock-takes'),
  p('physical_audit.scan', 'Scan assets during a stock-take'),

  // ----------------------------------------------------------------- sync --
  p('sync.read', 'View sync sources and run history'),
  p('sync.configure', 'Add or edit a sync source and its column mapping', true),
  p('sync.run', 'Trigger a manual sync', true),
  p('sync.migrate', 'Run a one-time migration and disconnect a sheet', true),
  p('sync.upload', 'Upload an Excel or CSV file for import', true),

  // --------------------------------------------------------------- backup --
  p('backup.read', 'View backup history'),
  p('backup.create', 'Trigger a manual backup', true),
  p('backup.download', 'Download a backup file', true),
  p('backup.restore', 'Restore the database from a backup', true),

  // --------------------------------------------------------------- system --
  p('dashboard.read', 'View dashboards'),
  p('report.read', 'View reports'),
  p('report.export', 'Export reports'),
  p('setting.read', 'View system settings'),
  p('setting.update', 'Change system settings', true),
  p('org.manage', 'Manage organisations, branches and locations', true),
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: string[] = PERMISSIONS.map((x) => x.key);

export const SENSITIVE_PERMISSIONS: string[] = PERMISSIONS.filter(
  (x) => x.sensitive,
).map((x) => x.key);

export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS.includes(key);
}
