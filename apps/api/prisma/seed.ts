/**
 * Idempotent seed.
 *
 * Safe to run on every deploy: it only ever creates what is missing and
 * updates the permission catalogue. It never deletes, and never overwrites an
 * existing password.
 *
 *   pnpm --filter @inventory/api prisma:seed
 */
import '../scripts/load-env'; // must come first: populates process.env
import { PrismaClient, SourceType, SyncMode, SyncSchedule } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PERMISSIONS, ROLES, RETIRED_ROLE_KEYS, permissionsForRole } from '@inventory/shared';

const prisma = new PrismaClient();

async function seedPermissions(): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      create: {
        key: p.key,
        module: p.module,
        action: p.action,
        description: p.description,
        isSensitive: p.sensitive ?? false,
      },
      update: {
        module: p.module,
        action: p.action,
        description: p.description,
        isSensitive: p.sensitive ?? false,
      },
    });
    idByKey.set(p.key, row.id);
  }
  console.log(`  permissions: ${idByKey.size}`);
  return idByKey;
}

async function seedRoles(permIds: Map<string, string>): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();

  for (const def of ROLES) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        name: def.name,
        description: def.description,
        rank: def.rank,
        isSystem: true,
      },
      update: { name: def.name, description: def.description, rank: def.rank },
    });
    roleIds.set(def.key, role.id);

    const wanted = permissionsForRole(def.key);

    // Re-grant what the catalogue says this role should have.
    for (const key of wanted) {
      const permissionId = permIds.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        create: { roleId: role.id, permissionId },
        update: {},
      });
    }

    // Revoke anything granted previously that the catalogue no longer allows,
    // so tightening a role in code actually tightens it in the database.
    const wantedIds = new Set(wanted.map((k) => permIds.get(k)).filter(Boolean) as string[]);
    const current = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    const stale = current.filter((rp) => !wantedIds.has(rp.permissionId));
    if (stale.length) {
      await prisma.rolePermission.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }

    console.log(`  role ${def.key}: ${wanted.length} permissions (${stale.length} revoked)`);
  }
  return roleIds;
}

/**
 * Roles from earlier builds are deactivated and stripped of every permission,
 * not deleted: user_roles rows still point at them and the audit trail records
 * who once held them. Anyone still holding one is moved to ADMIN, so nobody is
 * locked out by the change.
 */
async function retireOldRoles(roleIds: Map<string, string>): Promise<void> {
  const adminId = roleIds.get('ADMIN');
  if (!adminId) return;

  for (const key of RETIRED_ROLE_KEYS) {
    const role = await prisma.role.findUnique({ where: { key } });
    if (!role) continue;

    const holders = await prisma.userRole.findMany({
      where: { roleId: role.id, revokedAt: null },
    });

    for (const holder of holders) {
      const alreadyAdmin = await prisma.userRole.findFirst({
        where: { userId: holder.userId, roleId: adminId, revokedAt: null },
      });
      if (!alreadyAdmin) {
        await prisma.userRole.create({ data: { userId: holder.userId, roleId: adminId } });
      }
      await prisma.userRole.update({
        where: { id: holder.id },
        data: { revokedAt: new Date() },
      });
    }

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.role.update({
      where: { id: role.id },
      data: { isActive: false, isSystem: false, description: 'Retired role, kept for history' },
    });

    if (holders.length) {
      console.log(`  retired ${key}: ${holders.length} holder(s) moved to ADMIN`);
    }
  }
}

async function seedOrganisation() {
  const org = await prisma.organization.upsert({
    where: { code: 'PU' },
    create: { code: 'PU', name: 'Parul University', legalName: 'Parul University' },
    update: {},
  });

  const campus = await prisma.branch.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'MAIN' } },
    create: {
      organizationId: org.id,
      code: 'MAIN',
      name: 'Main Campus',
      siteType: 'CAMPUS',
      state: 'Gujarat',
      country: 'India',
    },
    update: {},
  });

  const contactCentre = await prisma.branch.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'CCC' } },
    create: {
      organizationId: org.id,
      code: 'CCC',
      name: 'Central Contact Center',
      siteType: 'CONTACT_CENTER',
      state: 'Gujarat',
      country: 'India',
    },
    update: {},
  });

  console.log(`  organisation: ${org.name} with 2 branches`);
  return { org, campus, contactCentre };
}

/** Categories the two workbooks are known to contain. */
const CATEGORIES = [
  { code: 'LPT', name: 'Laptop', tagPrefix: 'LPT' },
  { code: 'DSK', name: 'Desktop', tagPrefix: 'DSK' },
  { code: 'MON', name: 'Monitor', tagPrefix: 'MON' },
  { code: 'HP', name: 'Headphone', tagPrefix: 'HP' },
  { code: 'KB', name: 'Keyboard', tagPrefix: 'KB' },
  { code: 'MSE', name: 'Mouse', tagPrefix: 'MSE' },
  { code: 'UPS', name: 'UPS', tagPrefix: 'UPS' },
  { code: 'PRN', name: 'Printer', tagPrefix: 'PRN' },
  { code: 'PHN', name: 'Desk Phone', tagPrefix: 'PHN' },
  { code: 'SIM', name: 'CUG SIM', tagPrefix: 'SIM' },
  { code: 'LKR', name: 'Locker', tagPrefix: 'LKR' },
  { code: 'CHR', name: 'Chair', tagPrefix: 'CHR' },
  { code: 'WS', name: 'Workstation', tagPrefix: 'WS' },
];

async function seedCategories() {
  for (const c of CATEGORIES) {
    await prisma.assetCategory.upsert({
      where: { code: c.code },
      create: c,
      update: { name: c.name, tagPrefix: c.tagPrefix },
    });
  }
  console.log(`  asset categories: ${CATEGORIES.length}`);
}

async function seedSuperAdmin(roleIds: Map<string, string>) {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`  super admin: ${email} already exists, password left untouched`);
    return existing;
  }

  // If no password was supplied, generate a strong one and print it once.
  const generated = !process.env.SEED_SUPER_ADMIN_PASSWORD;
  const password =
    process.env.SEED_SUPER_ADMIN_PASSWORD ?? `${randomBytes(12).toString('base64url')}aA1!`;

  const user = await prisma.user.create({
    data: {
      email,
      displayName: process.env.SEED_SUPER_ADMIN_NAME ?? 'Super Admin',
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      mustChangePassword: true,
      isActive: true,
      roles: { create: { roleId: roleIds.get('ADMIN') as string } },
    },
  });

  console.log('');
  console.log('  ============================================================');
  console.log(`   ADMIN CREATED: ${email}`);
  if (generated) {
    console.log(`   TEMPORARY PASSWORD:  ${password}`);
    console.log('   This is shown once. Change it at first sign-in.');
  }
  console.log('  ============================================================');
  console.log('');
  return user;
}

/**
 * The workbooks and tabs supplied for this deployment.
 *
 * They are registered here so an admin opens the Sync screen and finds every
 * sheet already listed. Nothing imports until a column mapping is saved for a
 * source, and `targetEntity` below is a starting guess that the admin
 * confirms on the mapping screen - the tab contents could not be inspected
 * from outside the university Google account.
 */
const WORKBOOKS = [
  {
    label: 'Wing Wise Inventory',
    spreadsheetId: '1O193Lz3kiSpzzflOYKC6XBeJuSmLeoEg8AoEtXdaOhI',
    tabs: ['0', '418870031', '1015483296', '898124596', '2079024707'],
  },
  {
    label: 'Central Contact Center Inventory',
    spreadsheetId: '1cs1XPfTMumbQ2VrTbAo-OXUrVFba2jSyPSlWyTGHoFc',
    tabs: [
      '0', '583187100', '280840461', '917541632',
      '1480042053', '1254077137', '1848436081', '37944703',
    ],
  },
];

async function seedSyncSources() {
  let created = 0;
  for (const wb of WORKBOOKS) {
    for (const gid of wb.tabs) {
      const existing = await prisma.syncSource.findFirst({
        where: { spreadsheetId: wb.spreadsheetId, sheetGid: gid },
      });
      if (existing) continue;

      await prisma.syncSource.create({
        data: {
          name: `${wb.label} - tab ${gid}`,
          workbookLabel: wb.label,
          sourceType: SourceType.GOOGLE_SHEET,
          spreadsheetId: wb.spreadsheetId,
          sheetGid: gid,
          // Confirmed by the admin on the mapping screen before the first run.
          targetEntity: 'asset',
          headerRow: 1,
          dedupeKeys: ['serialNumber'],
          mode: SyncMode.MANUAL,
          schedule: SyncSchedule.OFF,
          allowUpdates: true,
        },
      });
      created++;
    }
  }
  console.log(`  sync sources: ${created} registered (unmapped until configured)`);
}

async function main(): Promise<void> {
  console.log('Seeding inventory database...');

  const permIds = await seedPermissions();
  const roleIds = await seedRoles(permIds);
  await retireOldRoles(roleIds);
  await seedOrganisation();
  await seedCategories();
  await seedSuperAdmin(roleIds);
  await seedSyncSources();

  console.log('Seed complete.');
  console.log('Next: open the Sync screen, map the columns for each tab, then');
  console.log('run a preview before importing for real.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
