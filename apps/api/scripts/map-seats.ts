/**
 * Gives seats to people: the seat-ownership table for the System and
 * Operations teams.
 *
 *   pnpm --filter @inventory/api seats:map [-- --dry-run]
 *
 * Each seat below gets one ACTIVE workstation allocation to the named
 * employee, and the team that owns the seat is written on it. Re-running
 * changes nothing that already matches; a seat that has moved to someone
 * else releases the old allocation first. Names are matched against the
 * employee master case-insensitively, with the spellings the sheet uses.
 */
import './load-env';
import { AllocationStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');

const MAPPING: Array<{ seat: string; name: string; team: string; aliases?: string[] }> = [
  { seat: '1C024', name: 'Krupa Parekh', team: 'System Team' },
  { seat: '1C025', name: 'Tushar Sharma', team: 'System Team' },
  { seat: '1C026', name: 'Aruz Shaikh', team: 'System Team' },
  { seat: '1C027', name: 'Akshish Parmar', team: 'System Team' },
  { seat: '1C028', name: 'Aswin Kumar', team: 'System Team' },
  { seat: '1C029', name: 'Adil Khan', team: 'System Team', aliases: ['Aadil Khan'] },
  { seat: '4D167', name: 'Kartik Sapkal', team: 'Operations Team' },
  { seat: '4D168', name: 'Amit Pandey', team: 'Operations Team' },
  { seat: '4D169', name: 'Aamir Patel', team: 'Operations Team' },
  { seat: '4D170', name: 'Gaurav Jain', team: 'Operations Team' },
  { seat: '4D171', name: 'Ritik Jha', team: 'Operations Team' },
  { seat: '4D172', name: 'Samarjeet Singh', team: 'Operations Team' },
];

async function main(): Promise<void> {
  const branch =
    (await prisma.branch.findFirst({ where: { code: 'CCC' } })) ??
    (await prisma.branch.findFirst({}));
  if (!branch) throw new Error('No branch in the database.');

  let done = 0;
  for (const m of MAPPING) {
    const seat = await prisma.workstation.findFirst({
      where: { branchId: branch.id, seatCode: m.seat, deletedAt: null },
    });
    if (!seat) { console.log(`${m.seat}: seat not found - skipped`); continue; }

    let person = null as null | { id: string; fullName: string; employeeCode: string };
    for (const candidate of [m.name, ...(m.aliases ?? [])]) {
      person = await prisma.employee.findFirst({
        where: { fullName: { equals: candidate, mode: 'insensitive' }, deletedAt: null },
        select: { id: true, fullName: true, employeeCode: true },
      });
      if (person) break;
    }
    if (!person) { console.log(`${m.seat}: no employee named "${m.name}" - skipped`); continue; }

    const remarks = `Team: ${m.team}`;
    const current = await prisma.workstationAllocation.findMany({
      where: { workstationId: seat.id, status: AllocationStatus.ACTIVE },
    });
    const keep = current.find((a) => a.employeeId === person!.id);
    const others = current.filter((a) => a.employeeId !== person!.id);

    if (keep && keep.remarks === remarks && others.length === 0) {
      console.log(`${m.seat}: ${person.fullName} - already mapped`);
      continue;
    }
    console.log(`${m.seat}: -> ${person.fullName} [${person.employeeCode}] (${m.team})` +
      (others.length ? `, releasing ${others.length} previous` : ''));
    done += 1;
    if (DRY) continue;

    await prisma.$transaction(async (tx) => {
      if (others.length) {
        await tx.workstationAllocation.updateMany({
          where: { id: { in: others.map((o) => o.id) } },
          data: { status: AllocationStatus.RETURNED, releasedAt: new Date(), remarks: 'Seat reassigned' },
        });
      }
      if (keep) {
        await tx.workstationAllocation.update({ where: { id: keep.id }, data: { remarks } });
      } else {
        await tx.workstationAllocation.create({
          data: {
            workstationId: seat.id,
            employeeId: person!.id,
            status: AllocationStatus.ACTIVE,
            allocatedAt: new Date(),
            remarks,
          },
        });
      }
    });
  }
  console.log(DRY ? `${done} seat(s) would change.` : `${done} seat(s) mapped.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
