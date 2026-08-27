import { PERMISSION_KEYS } from './permissions';

export const ROLE_KEYS = ['ADMIN', 'VIEWER'] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDef {
  key: RoleKey;
  name: string;
  description: string;
  /** Lower rank = more powerful. Nobody may grant a role at or above their own. */
  rank: number;
  /** '*' means every permission in the catalogue. */
  permissions: string[] | ['*'];
  /** Documented exclusions, asserted by a test so they cannot drift. */
  mustNotHave?: string[];
}

/**
 * Roles that existed in earlier builds. The seed deactivates them rather than
 * deleting, because user_roles rows still reference them and the audit trail
 * records who once held them.
 */
export const RETIRED_ROLE_KEYS = [
  'SUPER_ADMIN',
  'HR_ADMIN',
  'INVENTORY_MANAGER',
  'TEAM_LEADER',
  'EMPLOYEE',
] as const;

/**
 * Everything a Viewer may do. The list is exhaustive and contains only reads:
 * a permission reaches this list only if exercising it cannot alter a single
 * row. Anything that creates, edits, archives, allocates, imports, exports or
 * restores is deliberately absent.
 */
const VIEWER_PERMISSIONS = [
  'dashboard.read',
  'report.read',
  'asset.read',
  'asset.read_own',
  'asset.read_team',
  'allocation.read',
  'employee.read',
  'repair.read',
  'stock.read',
  'workspace.read',
  'locker.read',
  'cug.read',
  'request.read',
  'request.read_own',
  'approval.read',
];

export const ROLES: readonly RoleDef[] = [
  {
    key: 'ADMIN',
    name: 'Admin',
    description:
      'Full control. Manages inventory, people, users, roles, imports, backups ' +
      'and every setting.',
    rank: 10,
    permissions: ['*'],
  },
  {
    key: 'VIEWER',
    name: 'Viewer',
    description:
      'Read-only. Can look at every operational screen and change nothing.',
    rank: 90,
    permissions: VIEWER_PERMISSIONS,
    // Spelled out so a later edit to the catalogue cannot quietly hand a
    // Viewer the ability to change something.
    mustNotHave: [
      'asset.create', 'asset.update', 'asset.delete', 'asset.restore',
      'asset.purge', 'asset.bulk_update', 'asset.export', 'asset.print_label',
      'allocation.allocate', 'allocation.return', 'allocation.transfer',
      'allocation.override',
      'employee.create', 'employee.update', 'employee.delete',
      'employee.restore', 'employee.export', 'employee.read_pii',
      'repair.create', 'repair.update', 'repair.close', 'repair.manage_vendor',
      'stock.receive', 'stock.issue', 'stock.adjust',
      'workspace.manage', 'workspace.allocate',
      'locker.manage', 'locker.allocate',
      'cug.manage', 'cug.allocate',
      'request.create', 'request.fulfil', 'damage.report', 'damage.review',
      'approval.decide_manager', 'approval.decide_admin', 'approval.decide_super',
      'user.read', 'user.create', 'user.update', 'user.delete', 'user.restore',
      'user.reset_password', 'user.manage_mfa', 'user.impersonate',
      'role.read', 'role.create', 'role.update', 'role.delete', 'role.assign',
      'audit.read', 'audit.export',
      'physical_audit.manage', 'physical_audit.scan',
      'sync.read', 'sync.configure', 'sync.run', 'sync.migrate', 'sync.upload',
      'backup.read', 'backup.create', 'backup.download', 'backup.restore',
      'setting.read', 'setting.update', 'org.manage',
      'report.export',
    ],
  },
] as const;

/** Expands '*' and returns the concrete permission list for a role. */
export function permissionsForRole(key: RoleKey): string[] {
  const role = ROLES.find((r) => r.key === key);
  if (!role) return [];
  return role.permissions[0] === '*'
    ? [...PERMISSION_KEYS]
    : [...(role.permissions as string[])];
}

export function roleRank(key: string): number {
  return ROLES.find((r) => r.key === key)?.rank ?? Number.MAX_SAFE_INTEGER;
}

/** True when the role cannot alter any data at all. */
export function isReadOnlyRole(key: string): boolean {
  return key === 'VIEWER';
}
