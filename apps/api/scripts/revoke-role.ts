/**
 * Revokes a role from a user, and optionally deactivates the account.
 *
 *   pnpm --filter @inventory/api revoke:role -- \
 *     --email someone@example.com --role SUPER_ADMIN [--deactivate]
 *
 * Consistent with the rest of the system, nothing is deleted: the user_roles
 * row is stamped with revokedAt so the fact that the role was once held stays
 * in the record, and the account is soft-deactivated rather than removed.
 *
 * Refuses to revoke the last active SUPER_ADMIN, because an installation with
 * no administrator cannot be repaired through the web interface at all.
 */
import './load-env'; // must come first: populates process.env
import { PrismaClient, AuditAction } from '@prisma/client';
import { ROLE_KEYS, type RoleKey } from '@inventory/shared';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const email = (arg('email') ?? '').toLowerCase().trim();
  const roleKey = (arg('role') ?? '').toUpperCase() as RoleKey;
  const deactivate = flag('deactivate');

  if (!email || !roleKey) {
    console.error('Usage: revoke:role -- --email someone@example.com --role SUPER_ADMIN [--deactivate]');
    process.exit(1);
  }
  if (!ROLE_KEYS.includes(roleKey)) {
    console.error(`Unknown role "${roleKey}". Valid roles: ${ROLE_KEYS.join(', ')}`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: { where: { revokedAt: null }, include: { role: true } } },
  });
  if (!user) {
    console.error(`No user with email "${email}".`);
    process.exit(1);
  }

  const held = user.roles.find((r) => r.role.key === roleKey);
  if (!held) {
    console.log(`${email} does not currently hold ${roleKey}. Nothing to do.`);
    return;
  }

  // An installation with no administrator cannot be repaired from the web UI.
  if (roleKey === 'SUPER_ADMIN') {
    const remaining = await prisma.userRole.count({
      where: {
        revokedAt: null,
        role: { key: 'SUPER_ADMIN' },
        user: { isActive: true, deletedAt: null, id: { not: user.id } },
      },
    });
    if (remaining === 0) {
      console.error(
        `Refusing: ${email} is the last active Super Admin.\n` +
          'Grant SUPER_ADMIN to another account first:\n' +
          '  pnpm --filter @inventory/api create:user -- --email you@example.com --role SUPER_ADMIN',
      );
      process.exit(1);
    }
    console.log(`${remaining} other active Super Admin account(s) will remain.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.userRole.update({
      where: { id: held.id },
      data: { revokedAt: new Date() },
    });

    if (deactivate) {
      await tx.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
    }

    // Any session already issued keeps its access token until it expires, so
    // end them explicitly rather than waiting the token lifetime out.
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ROLE_REVOKED_CLI' },
    });

    // The audit trail is the point of this system; a change made through the
    // CLI is recorded exactly as one made through the API would be.
    await tx.auditLog.create({
      data: {
        action: AuditAction.ROLE_REVOKED,
        entityType: 'User',
        entityId: user.id,
        entityLabel: `${user.displayName} (${user.email})`,
        userName: 'Administrator (CLI)',
        roleKeys: [],
        oldValue: { roles: user.roles.map((r) => r.role.key), isActive: user.isActive },
        newValue: {
          roles: user.roles.map((r) => r.role.key).filter((k) => k !== roleKey),
          isActive: deactivate ? false : user.isActive,
        },
        changedFields: deactivate ? ['roles', 'isActive'] : ['roles'],
        summary:
          `Revoked ${roleKey} from ${user.email} via the command line` +
          (deactivate ? ' and deactivated the account' : ''),
      },
    });
  });

  console.log(`Revoked ${roleKey} from ${email}.`);
  if (deactivate) console.log('Account deactivated (soft; the record and its history are kept).');
  console.log('Existing sessions revoked.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
