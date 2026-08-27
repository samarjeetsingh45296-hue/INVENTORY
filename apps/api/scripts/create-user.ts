/**
 * Provisions a user account and assigns it a role.
 *
 *   pnpm --filter @inventory/api create:user -- \
 *     --email you@example.com --name "Your Name" --role ADMIN
 *
 * The account is created with a random password nobody knows - not even the
 * person running this - and flagged mustChangePassword. The real credential is
 * set separately with `set:password`, which prompts for it with echo
 * suppressed. Passwords are never accepted as arguments here, so they cannot
 * leak through shell history, the process list, or a terminal transcript.
 */
import './load-env'; // must come first: populates process.env
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { ROLE_KEYS, type RoleKey } from '@inventory/shared';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = (arg('email') ?? '').toLowerCase().trim();
  const name = arg('name') ?? email.split('@')[0] ?? 'User';
  const roleKey = (arg('role') ?? 'EMPLOYEE').toUpperCase() as RoleKey;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Usage: create:user -- --email you@example.com --name "Your Name" --role ADMIN');
    process.exit(1);
  }

  if (!ROLE_KEYS.includes(roleKey)) {
    console.error(`Unknown role "${roleKey}". Valid roles: ${ROLE_KEYS.join(', ')}`);
    process.exit(1);
  }

  const role = await prisma.role.findUnique({ where: { key: roleKey } });
  if (!role) {
    console.error(`Role ${roleKey} is not in the database. Run the seed first.`);
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    include: { roles: { include: { role: true } } },
  });

  if (existing) {
    const has = existing.roles.some((r) => r.role.key === roleKey && !r.revokedAt);
    if (has) {
      console.log(`${email} already exists and already holds ${roleKey}. Nothing to do.`);
      console.log(`To set its password: pnpm --filter @inventory/api set:password -- --email ${email}`);
      return;
    }
    await prisma.userRole.create({ data: { userId: existing.id, roleId: role.id } });
    console.log(`${email} already existed; granted ${roleKey}.`);
    console.log(`To set its password: pnpm --filter @inventory/api set:password -- --email ${email}`);
    return;
  }

  // A password nobody knows. The account cannot be signed into until someone
  // sets a real one, so this script never puts a usable credential anywhere.
  const unusable = randomBytes(48).toString('base64url');

  const user = await prisma.user.create({
    data: {
      email,
      displayName: name,
      passwordHash: await argon2.hash(unusable, { type: argon2.argon2id }),
      mustChangePassword: true,
      isActive: true,
      roles: { create: { roleId: role.id } },
    },
  });

  const permissionCount = await prisma.rolePermission.count({ where: { roleId: role.id } });

  console.log(`Created ${user.email} with role ${roleKey} (${permissionCount} permissions).`);
  console.log('It has no usable password yet. Set one with:');
  console.log(`  pnpm --filter @inventory/api set:password -- --email ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
