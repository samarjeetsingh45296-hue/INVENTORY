/**
 * The employee master - the TL Attendance workbook - into the database.
 *
 * Its "2026" tab is the roster: MIS number, name, level, joining date,
 * gender, date of birth, CUG number, email, institute. The "Ex - Employee"
 * tab is everyone who has left. Levels, joining dates and who is still on
 * staff come from here; the master wins over anything an earlier import
 * guessed. Nothing is deleted: a person who has left is marked as having
 * left, and what they still hold is listed for review.
 */
import { EmploymentStatus, type PrismaClient } from '@prisma/client';
import type { SheetSource } from '../sheet-source';

const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** "20/02/2023" or "2023-02-20"; anything else is null. */
function parseDate(v: string): Date | null {
  const s = S(v);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
  return null;
}

function splitName(full: string): { first: string; last: string | null } {
  const parts = full.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length === 1) return { first: parts[0] ?? 'Unknown', last: null };
  return { first: parts[0] as string, last: parts.slice(1).join(' ') };
}

export interface MasterImportResult {
  counts: Record<string, number>;
  /** MIS numbers the master lists as current staff. */
  onRoster: Set<string>;
  /** MIS numbers the master lists as having left. */
  left: Set<string>;
  tabsFailed: string[];
}

export async function runMasterImport(
  prisma: PrismaClient,
  src: SheetSource,
  opts: { dry?: boolean; log?: (line: string) => void } = {},
): Promise<MasterImportResult> {
  const DRY = opts.dry ?? false;
  const log = opts.log ?? (() => undefined);
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  const onRoster = new Set<string>();
  const left = new Set<string>();
  const tabsFailed: string[] = [];

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('No organisation. Run the seed first.');
  const branch =
    (await prisma.branch.findFirst({ where: { organizationId: org.id, code: 'CCC' } })) ??
    (await prisma.branch.findFirst({ where: { organizationId: org.id } }));
  if (!branch) throw new Error('No branch. Run the seed first.');

  // ------------------------------------------------------------ roster --
  try {
    const table = await src.read('2026', 1);
    for (const row of table.rows) {
      const r = row.raw;
      const mis = S(r['MIS NO']).replace(/\D/g, '');
      const name = S(r['Name']).replace(/\s+/g, ' ');
      if (!mis || !name || name === '-') continue;
      onRoster.add(mis);

      const level = S(r['Level']).toUpperCase() || null;
      const email = S(r['Email- ID'] ?? r['Email ID'] ?? r['Email']).toLowerCase() || null;
      const phone = S(r['CugNo'] ?? r['Cug No']).replace(/\D/g, '') || null;
      const doj = parseDate(S(r['DOJ']));
      const dob = parseDate(S(r['DOB']));
      const gender = S(r['Gender']).toUpperCase() || null;
      const institute = S(r['Institute']) || null;

      const existing = await prisma.employee.findFirst({
        where: { organizationId: org.id, employeeCode: mis },
      });

      if (!existing) {
        bump('employeesCreated');
        if (DRY) continue;
        const { first, last } = splitName(name);
        await prisma.employee.create({
          data: {
            organizationId: org.id,
            branchId: branch.id,
            employeeCode: mis,
            firstName: first,
            lastName: last,
            fullName: name,
            level,
            officialEmail: email,
            phone,
            dateOfJoining: doj,
            dateOfBirth: dob,
            gender,
            employmentStatus: EmploymentStatus.ACTIVE,
            remarks: institute ? `Institute: ${institute}` : null,
          },
        });
        continue;
      }

      // The master wins for what it states; blanks on the site are filled.
      const patch: Record<string, unknown> = {};
      if (level && existing.level !== level) patch.level = level;
      if (email && !existing.officialEmail) patch.officialEmail = email;
      if (phone && !existing.phone) patch.phone = phone;
      if (doj && !existing.dateOfJoining) patch.dateOfJoining = doj;
      if (dob && !existing.dateOfBirth) patch.dateOfBirth = dob;
      if (gender && !existing.gender) patch.gender = gender;
      if (existing.deletedAt) { patch.deletedAt = null; patch.deletedById = null; patch.isActive = true; }
      if (existing.employmentStatus !== EmploymentStatus.ACTIVE) patch.employmentStatus = EmploymentStatus.ACTIVE;
      if (Object.keys(patch).length) {
        if (patch.level) bump('levelsChanged');
        if (patch.employmentStatus || patch.deletedAt === null) bump('employeesReinstated');
        bump('employeesUpdated');
        if (!DRY) await prisma.employee.update({ where: { id: existing.id }, data: patch });
      } else {
        bump('employeesUnchanged');
      }
    }
    log(`  2026 ... ${onRoster.size} on roster`);
  } catch (err) {
    tabsFailed.push(`2026: ${(err as Error).message}`);
    log(`  2026 ... FAILED: ${(err as Error).message}`);
  }

  // ------------------------------------------------------------- left --
  try {
    const table = await src.read('Ex - Employee', 1);
    for (const row of table.rows) {
      const r = row.raw;
      const mis = S(r['MIS NO']).replace(/\D/g, '');
      if (!mis || onRoster.has(mis)) continue;
      left.add(mis);
      const existing = await prisma.employee.findFirst({
        where: { organizationId: org.id, employeeCode: mis, deletedAt: null },
      });
      if (!existing || existing.employmentStatus !== EmploymentStatus.ACTIVE) continue;
      bump('employeesMarkedLeft');
      if (DRY) continue;
      await prisma.employee.update({
        where: { id: existing.id },
        data: {
          employmentStatus: EmploymentStatus.RESIGNED,
          remarks: [existing.remarks, 'Left: listed under Ex-Employee on the master sheet'].filter(Boolean).join(' | '),
        },
      });
    }
    log(`  Ex - Employee ... ${left.size} left`);
  } catch (err) {
    tabsFailed.push(`Ex - Employee: ${(err as Error).message}`);
    log(`  Ex - Employee ... FAILED: ${(err as Error).message}`);
  }

  return { counts, onRoster, left, tabsFailed };
}
