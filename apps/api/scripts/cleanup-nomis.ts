/**
 * Removes the fake "employees" created by the first import.
 *
 *   pnpm --filter @inventory/api cleanup:nomis [-- --dry-run]
 *
 * The Stock and Locker sheets put notes where a holder's name goes -
 * "(Scrap)", "Need to Repair", "Stock1", bare seat numbers, even "SSD Lenovo
 * Laptop" - and the importer faithfully turned each into an employee. This
 * undoes that without losing a word of the source data:
 *
 *   - the note moves onto the asset/connection/locker it was describing;
 *   - the asset's status becomes what the note actually meant
 *     (Scrap -> SCRAPPED, Need to Repair -> IN_REPAIR, otherwise IN_STOCK);
 *   - the bogus allocation is voided, never deleted;
 *   - the fake employee is archived, never deleted;
 *   - every step lands on the audit trail.
 *
 * Real people who merely lack an MIS number are left alone. Anything the
 * classifier does not recognise fails safe: it is kept as a person.
 */
import './load-env';
import {
  AllocationStatus, AssetEventType, AssetStatus, AuditAction, CugStatus,
  LockerStatus, PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');

/** A NOMIS- record is junk when its "name" is a note, not a person. */
function isJunkName(name: string): boolean {
  const n = name.toLowerCase().trim();
  if (/^\d+$/.test(n)) return true;             // bare numbers
  if (/\bscrap\b/.test(n)) return true;
  if (/need\s*to\s*repair/.test(n)) return true;
  if (/not\s*working/.test(n)) return true;
  if (/^stock\s*\d*$/.test(n)) return true;     // Stock, Stock1, Stock 17
  if (/^new\s*cug/.test(n)) return true;
  if (/guest\s*house/.test(n)) return true;
  if (/^chat\s*support$/.test(n)) return true;
  if (/^pid\b/.test(n)) return true;
  if (/laptop|lenovo|ssd/.test(n)) return true; // it is equipment
  return false;
}

/** What the note was actually saying about the item it sat beside. */
function statusFor(note: string): { asset: AssetStatus; why: string } {
  const n = note.toLowerCase();
  if (/\bscrap\b/.test(n)) return { asset: AssetStatus.SCRAPPED, why: 'sheet marked it scrap' };
  if (/need\s*to\s*repair|not\s*working/.test(n)) {
    return { asset: AssetStatus.IN_REPAIR, why: 'sheet marked it needing repair' };
  }
  return { asset: AssetStatus.IN_STOCK, why: 'holder was a note, so the item is unassigned' };
}

/** Appends without duplicating on a re-run. */
function appendNote(existing: string | null, note: string): string {
  const parts = [existing, `Sheet note: ${note}`].filter(Boolean) as string[];
  return parts.filter((v, i, a) => a.indexOf(v) === i).join(' | ');
}

async function main(): Promise<void> {
  const candidates = await prisma.employee.findMany({
    where: { employeeCode: { startsWith: 'NOMIS-' }, deletedAt: null },
    include: {
      allocations: { where: { status: AllocationStatus.ACTIVE }, include: { asset: true } },
      cugAllocations: { where: { status: AllocationStatus.ACTIVE }, include: { connection: true } },
      lockerAllocations: { where: { status: AllocationStatus.ACTIVE }, include: { locker: true } },
    },
  });

  const junk = candidates.filter((e) => isJunkName(e.fullName));
  const kept = candidates.filter((e) => !isJunkName(e.fullName));

  console.log(`NOMIS records: ${candidates.length}  ->  junk: ${junk.length}, kept as people: ${kept.length}`);
  console.log(`\nKept (untouched): ${kept.map((e) => e.fullName).join(', ')}`);
  console.log(`\n${DRY ? 'DRY RUN - what would happen' : 'Applying'}:`);

  let assetsFixed = 0;
  let cugFixed = 0;
  let lockersFixed = 0;

  for (const emp of junk) {
    const note = emp.fullName;
    console.log(`\n  ${emp.employeeCode}  "${note}"`);

    for (const alloc of emp.allocations) {
      const { asset: newStatus, why } = statusFor(note);
      console.log(`    asset ${alloc.asset.assetTag}: -> ${newStatus} (${why})`);
      assetsFixed++;
      if (DRY) continue;

      await prisma.$transaction(async (tx) => {
        await tx.assetAllocation.update({
          where: { id: alloc.id },
          data: {
            deletedAt: new Date(),
            voidReason: `Holder "${note}" was a sheet note, not a person`,
          },
        });
        await tx.asset.update({
          where: { id: alloc.assetId },
          data: {
            status: newStatus,
            currentHolderEmployeeId: null,
            currentAllocationId: null,
            notes: appendNote(alloc.asset.notes, note),
          },
        });
        await tx.assetEvent.create({
          data: {
            assetId: alloc.assetId,
            eventType: AssetEventType.STATUS_CHANGED,
            summary: `Fake holder "${note}" removed; status ${newStatus} because the ${why}`,
            fromValue: { status: alloc.asset.status, holder: note },
            toValue: { status: newStatus, holder: null },
            actorName: 'NOMIS clean-up',
          },
        });
      });
    }

    for (const c of emp.cugAllocations) {
      console.log(`    cug ${c.connection.mobileNumber}: released, note kept`);
      cugFixed++;
      if (DRY) continue;
      await prisma.$transaction(async (tx) => {
        await tx.cugAllocation.update({
          where: { id: c.id },
          data: {
            status: AllocationStatus.CANCELLED,
            releasedAt: new Date(),
            remarks: `Voided: holder "${note}" was a sheet note, not a person`,
          },
        });
        await tx.cugConnection.update({
          where: { id: c.connectionId },
          data: { status: CugStatus.AVAILABLE, notes: appendNote(c.connection.notes, note) },
        });
      });
    }

    for (const l of emp.lockerAllocations) {
      const broken = /not\s*working|repair/i.test(note);
      console.log(`    locker ${l.locker.lockerNo}: released${broken ? ', marked under maintenance' : ''}`);
      lockersFixed++;
      if (DRY) continue;
      await prisma.$transaction(async (tx) => {
        await tx.lockerAllocation.update({
          where: { id: l.id },
          data: {
            status: AllocationStatus.CANCELLED,
            releasedAt: new Date(),
            remarks: `Voided: holder "${note}" was a sheet note, not a person`,
          },
        });
        await tx.locker.update({
          where: { id: l.lockerId },
          data: {
            status: broken ? LockerStatus.UNDER_MAINTENANCE : LockerStatus.AVAILABLE,
            notes: appendNote(l.locker.notes, note),
          },
        });
      });
    }

    if (!DRY) {
      await prisma.employee.update({
        where: { id: emp.id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          remarks: [emp.remarks, 'Archived: created from a sheet note, not a person']
            .filter(Boolean)
            .join(' | '),
        },
      });
      await prisma.auditLog.create({
        data: {
          action: AuditAction.SOFT_DELETE,
          entityType: 'Employee',
          entityId: emp.id,
          entityLabel: `${emp.fullName} (${emp.employeeCode})`,
          userName: 'NOMIS clean-up (CLI)',
          roleKeys: [],
          summary:
            `Archived fake employee "${emp.fullName}": the name was a sheet note. ` +
            'Its allocations were voided and the note moved onto the items themselves.',
        },
      });
    }
  }

  console.log(
    `\nSummary: ${junk.length} fake employees archived, ${assetsFixed} assets restated, ` +
      `${cugFixed} CUG lines released, ${lockersFixed} lockers released` +
      (DRY ? '  (dry run - nothing written)' : ''),
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
