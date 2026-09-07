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
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
