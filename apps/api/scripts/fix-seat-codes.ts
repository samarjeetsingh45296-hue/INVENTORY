/**
 * Repairs seat codes that a spreadsheet turned into numbers.
 *
 *   pnpm --filter @inventory/api fix:seat-codes [-- --dry-run]
 *
 * "3E114" and "4E173" look like scientific notation to a spreadsheet, so the
 * Wing E stations arrived as "3e+114" and "4e+173" - real seats with their
 * kit, invisible on the floor plan because nothing could read the code. This
 * puts the codes back ("3E114", "4E173") and fixes the holder labels on their
 * allocations to match. Safe to run again: it changes nothing once clean.
 */
import './load-env';
import { PrismaClient } from '@prisma/client';
import { unmangleSeatCode } from '../src/modules/sync/transform';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');

async function main() {
  const stations = await prisma.workstation.findMany({
    select: { id: true, seatCode: true },
  });
  let fixed = 0;
  for (const w of stations) {
    const clean = unmangleSeatCode(w.seatCode);
    if (clean === w.seatCode) continue;
    console.log(`${w.seatCode}  ->  ${clean}`);
    fixed += 1;
    if (DRY) continue;
    await prisma.$transaction([
      prisma.workstation.update({ where: { id: w.id }, data: { seatCode: clean } }),
      prisma.assetAllocation.updateMany({
        where: { holderRefId: w.id, holderLabel: `Station ${w.seatCode}` },
        data: { holderLabel: `Station ${clean}` },
      }),
    ]);
  }
  console.log(DRY ? `${fixed} seat code(s) would be repaired.` : `${fixed} seat code(s) repaired.`);

  // Locker keys are seat codes too. A mangled key whose proper twin already
  // exists is archived (its holder's allocation returned); otherwise it is
  // renamed in place.
  const lockers = await prisma.locker.findMany({ where: { deletedAt: null }, select: { id: true, lockerNo: true, keyNumber: true, branchId: true } });
  let lockersFixed = 0;
  for (const l of lockers) {
    const clean = unmangleSeatCode(l.lockerNo);
    if (clean === l.lockerNo) continue;
    const twin = lockers.find((o) => o.id !== l.id && o.lockerNo === clean && o.branchId === l.branchId);
    console.log(`locker ${l.lockerNo}  ->  ${twin ? `archived (duplicate of ${clean})` : clean}`);
    lockersFixed += 1;
    if (DRY) continue;
    if (twin) {
      await prisma.$transaction([
        prisma.lockerAllocation.updateMany({
          where: { lockerId: l.id, status: 'ACTIVE' },
          data: { status: 'RETURNED', releasedAt: new Date(), keyReturned: true, remarks: 'Duplicate key record retired' },
        }),
        prisma.locker.update({ where: { id: l.id }, data: { deletedAt: new Date(), status: 'RETIRED', notes: `Duplicate of ${clean}` } }),
      ]);
    } else {
      await prisma.locker.update({ where: { id: l.id }, data: { lockerNo: clean, keyNumber: l.keyNumber ? unmangleSeatCode(l.keyNumber) : l.keyNumber } });
    }
  }
  console.log(DRY ? `${lockersFixed} locker key(s) would be repaired.` : `${lockersFixed} locker key(s) repaired.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
