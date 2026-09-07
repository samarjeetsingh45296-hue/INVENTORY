/**
 * Undoes the assets one import run created, by archiving them.
 *
 *   pnpm --filter @inventory/api assets:archive-run -- --run <syncRunId> [--dry-run]
 *
 * For when a run is known to have created copies of things that already
 * existed. Every asset the run created (its sync rows point at them, and
 * they were created after the run started) is archived and its active
 * allocations returned. Archived, not destroyed: the change history keeps
 * them and they can be restored.
 */
import './load-env';
import { AllocationStatus, AuditAction, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const runId = arg('run');
  if (!runId) throw new Error('Usage: assets:archive-run -- --run <syncRunId> [--dry-run]');
  const run = await prisma.syncRun.findFirst({ where: { id: runId }, include: { source: true } });
  if (!run) throw new Error(`No sync run ${runId}`);

  const rows = await prisma.syncRow.findMany({
    where: { runId, entityType: 'Asset', entityId: { not: null } },
    select: { entityId: true },
  });
  const ids = [...new Set(rows.map((r) => r.entityId as string))];
  const created = await prisma.asset.findMany({
    where: { id: { in: ids }, createdAt: { gte: run.startedAt }, deletedAt: null },
    include: { category: { select: { name: true } } },
    orderBy: { assetTag: 'asc' },
  });
  console.log(`Run ${runId} (${run.source.name}, ${run.startedAt.toISOString()}) created ${created.length} asset(s)${DRY ? '   DRY RUN' : ''}`);
  for (const a of created) console.log(`  ${a.assetTag}  ${a.category.name}  ${a.model ?? '-'}`);
  if (DRY || created.length === 0) return;

  const now = new Date();
  await prisma.$transaction([
    prisma.assetAllocation.updateMany({
      where: { assetId: { in: created.map((a) => a.id) }, status: AllocationStatus.ACTIVE },
      data: { status: AllocationStatus.RETURNED, returnedAt: now, returnRemarks: 'Import run undone' },
    }),
    prisma.asset.updateMany({
      where: { id: { in: created.map((a) => a.id) } },
      data: { deletedAt: now, currentHolderEmployeeId: null, currentAllocationId: null },
    }),
    prisma.auditLog.create({
      data: {
        action: AuditAction.SOFT_DELETE,
        entityType: 'SyncRun',
        entityId: runId,
        entityLabel: run.source.name,
        userName: 'Archive run assets (CLI)',
        roleKeys: [],
        summary: `Archived the ${created.length} asset(s) created by import run ${runId}: ${created.map((a) => a.assetTag).join(', ')}`,
      },
    }),
  ]);
  console.log(`Archived ${created.length} asset(s).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
