/**
 * Promote team levels out of the remarks text into the dedicated column.
 *
 * The Core-team import recorded each person's level from the master sheet
 * as "Level: L2 | ..." in remarks. That text stays as provenance; this copies
 * the value into `level`, where every screen can show it beside the name.
 *
 * Idempotent: only rows with an empty `level` and a parsable remark change.
 *   pnpm --filter @inventory/api exec ts-node --transpile-only scripts/backfill-levels.ts
 */
import './load-env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** "Cancellation (L1)" -> "L1"; otherwise the trimmed value as written. */
function normalise(raw: string): string {
  const inner = /\(([^)]+)\)/.exec(raw);
  const v = (inner?.[1] ?? raw).trim();
  return v.replace(/\s+/g, ' ').toUpperCase();
}

async function main() {
  const rows = await prisma.employee.findMany({
    where: { level: null, remarks: { contains: 'Level:' } },
    select: { id: true, fullName: true, remarks: true },
  });
  let updated = 0;
  const dist: Record<string, number> = {};
  for (const r of rows) {
    const m = /Level:\s*([^|]+)/.exec(r.remarks ?? '');
    if (!m) continue;
    const level = normalise(m[1]!);
    if (!level) continue;
    await prisma.employee.update({ where: { id: r.id }, data: { level } });
    dist[level] = (dist[level] ?? 0) + 1;
    updated += 1;
  }
  const total = await prisma.employee.count({ where: { deletedAt: null } });
  const withLevel = await prisma.employee.count({ where: { deletedAt: null, level: { not: null } } });
  console.log(JSON.stringify({ candidates: rows.length, updated, dist, total, withLevel }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
