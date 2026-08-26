import { PERMISSION_KEYS } from './permissions';

export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'HR_ADMIN',
  'INVENTORY_MANAGER',
  'TEAM_LEADER',
  'EMPLOYEE',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDef {
  key: RoleKey;
  name: string;
  description: string;
  /** Lower rank = more powerful. Nobody may grant a role at or above their own rank. */
  rank: number;
  /** '*' means every permission in the catalogue. */
  permissions: string[] | ['*'];
  /** Documented exclusions - asserted by a unit test so they cannot drift. */
  mustNotHave?: string[];
}

export const ROLES: readonly RoleDef[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description:
      'Unrestricted access, including user management, permanent deletion and backup restore.',
    rank: 10,
    permissions: ['*'],
  },
  {
    key: 'HR_ADMIN',
    name: 'HR Admin',
    description:
      'Runs day-to-day asset and employee operations. Cannot delete system records or touch the audit trail.',
    rank: 20,
    permissions: [
      'dashboard.read', 'report.read', 'report.export',
      'employee.read', 'employee.read_pii', 'employee.create',
      'employee.update', 'employee.delete', 'employee.export',
      'asset.read', 'asset.create', 'asset.update', 'asset.export',
      'asset.print_label', 'asset.delete',
      'allocation.read', 'allocation.allocate', 'allocation.return',
      'allocation.transfer',
      'repair.read', 'repair.create', 'repair.update', 'repair.close',
      'stock.read', 'stock.receive', 'stock.issue',
      'workspace.read', 'workspace.manage', 'workspace.allocate',
      'locker.read', 'locker.manage', 'locker.allocate',
      'cug.read', 'cug.manage', 'cug.allocate',
      'request.read', 'request.create', 'request.fulfil',
      'damage.review',
      'approval.read', 'approval.decide_admin',
      'physical_audit.manage', 'physical_audit.scan',
      'sync.read', 'sync.run', 'sync.upload',
      'backup.read', 'backup.create',
      'setting.read',
      'user.read',
    ],
    // "Cannot: Delete System Records, Delete Audit Logs"
    mustNotHave: [
      'asset.purge', 'user.delete', 'user.create', 'user.update',
      'role.assign', 'role.create', 'role.update', 'role.delete',
      'audit.export', 'backup.restore', 'setting.update',
      'org.manage', 'user.impersonate', 'sync.migrate',
    ],
  },
  {
    key: 'INVENTORY_MANAGER',
    name: 'Inventory Manager',
    description:
      'Owns inventory, repairs and stock. No access to user management.',
    rank: 30,
    permissions: [
      'dashboard.read', 'report.read', 'report.export',
      'employee.read',
      'asset.read', 'asset.create', 'asset.update', 'asset.export',
      'asset.print_label',
      'allocation.read', 'allocation.allocate', 'allocation.return',
      'allocation.transfer',
      'repair.read', 'repair.create', 'repair.update', 'repair.close',
      'repair.manage_vendor',
      'stock.read', 'stock.receive', 'stock.issue',
      'workspace.read', 'workspace.allocate',
      'locker.read', 'locker.manage', 'locker.allocate',
      'cug.read', 'cug.manage', 'cug.allocate',
      'request.read', 'request.fulfil',
      'damage.review',
      'approval.read',
      'physical_audit.manage', 'physical_audit.scan',
      'sync.read',
    ],
    // "Cannot: Access User Management"
    mustNotHave: [
      'user.read', 'user.create', 'user.update', 'user.delete',
      'user.reset_password', 'user.manage_mfa', 'user.impersonate',
      'role.read', 'role.create', 'role.update', 'role.delete', 'role.assign',
      'asset.purge', 'asset.delete', 'backup.restore', 'audit.read',
    ],
  },
  {
    key: 'TEAM_LEADER',
    name: 'Team Leader',
    description:
      'Sees the assets held by their reporting team, raises requests and reports damage. Read-only on inventory.',
    rank: 40,
    permissions: [
      'dashboard.read',
      'asset.read_own', 'asset.read_team',
      'allocation.read',
      'employee.read',
      'request.read', 'request.read_own', 'request.create',
      'repair.read', 'repair.create',
      'damage.report',
      'approval.read', 'approval.decide_manager',
      'workspace.read', 'locker.read', 'cug.read', 'stock.read',
      'physical_audit.scan',
    ],
    // "Cannot: Modify Inventory"
    mustNotHave: [
      'asset.create', 'asset.update', 'asset.delete', 'asset.purge',
      'asset.bulk_update', 'allocation.allocate', 'allocation.return',
      'allocation.transfer', 'stock.receive', 'stock.issue', 'stock.adjust',
      'workspace.manage', 'locker.manage', 'cug.manage',
      'user.read', 'role.read', 'sync.run', 'backup.create',
    ],
  },
  {
    key: 'EMPLOYEE',
    name: 'Employee',
    description:
      'Sees only their own assets, raises repair and asset requests.',
    rank: 50,
    permissions: [
      'asset.read_own',
      'request.read_own', 'request.create',
      'repair.create',
      'damage.report',
    ],
    // "Cannot: Edit Inventory"
    mustNotHave: [
      'asset.read', 'asset.create', 'asset.update', 'asset.delete',
      'asset.bulk_update', 'allocation.allocate', 'allocation.return',
      'employee.read', 'user.read', 'role.read', 'audit.read',
      'sync.run', 'backup.create', 'approval.decide_manager',
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
