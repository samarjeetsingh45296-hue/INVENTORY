/**
 * One reconciliation pass, by hand - the same the API runs at 09:00, 12:00,
 * 15:00 and 18:00.
 *
 *   pnpm --filter @inventory/api reconcile:run
 *
 * Boots the API's modules (no HTTP), runs the pass, prints the summary.
 */
import './load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReconcileService } from '../src/modules/reconcile/reconcile.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RequestContextStore } from '../src/common/context/request-context';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const service = app.get(ReconcileService);
    const prisma = app.get(PrismaService);
    const { id } = await RequestContextStore.runAsSystem('reconciliation-cli', () => service.run('cli'));
    const run = await prisma.reconciliationRun.findFirst({ where: { id } });
    console.log(`Run ${id}: ${run?.status} in ${Math.round((run?.durationMs ?? 0) / 1000)}s`);
    console.log(`Sheet connected: ${run?.sheetConnected} (${run?.sourceNote ?? '-'})`);
    const summary = (run?.summary ?? {}) as Record<string, unknown>;
    for (const p of (summary.problems as string[] | undefined) ?? []) console.log(`  ! ${p}`);
    console.log('Exceptions:');
    for (const [k, v] of Object.entries((summary.exceptionCounts as Record<string, number>) ?? {})) {
      console.log(`  ${k.padEnd(32)} ${v}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
