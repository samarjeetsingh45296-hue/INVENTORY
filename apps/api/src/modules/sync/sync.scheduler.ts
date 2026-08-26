import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncSchedule, SyncStatus } from '@prisma/client';
import { Inject } from '@nestjs/common';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { SyncEngine } from './sync.engine';
import { RequestContextStore } from '../../common/context/request-context';

/**
 * Option 2 of the sync design: scheduled imports.
 *
 * Each source carries its own cadence, so one sheet can refresh hourly while
 * another stays manual. A source that has been disconnected is skipped
 * outright, and a failure on one source never stops the others.
 */
@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly engine: SyncEngine,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'sync-hourly' })
  hourly(): Promise<void> {
    return this.runDue(SyncSchedule.HOURLY);
  }

  @Cron('0 */6 * * *', { name: 'sync-six-hourly' })
  sixHourly(): Promise<void> {
    return this.runDue(SyncSchedule.SIX_HOURLY);
  }

  @Cron(process.env.SYNC_DAILY_AT_CRON ?? '0 2 * * *', {
    name: 'sync-daily',
    timeZone: process.env.TZ ?? 'Asia/Kolkata',
  })
  daily(): Promise<void> {
    return this.runDue(SyncSchedule.DAILY);
  }

  private async runDue(schedule: SyncSchedule): Promise<void> {
    const sources = await this.prisma.syncSource.findMany({
      where: { schedule, isDisconnected: false, isActive: true },
    });

    if (sources.length === 0) return;
    this.logger.log(`Running ${schedule} sync for ${sources.length} source(s)`);

    for (const source of sources) {
      await RequestContextStore.runAsSystem(`sync-${schedule.toLowerCase()}`, async () => {
        try {
          const result = await this.engine.run({ sourceId: source.id, dryRun: false });
          if (result.status === SyncStatus.AWAITING_CONFIRMATION) {
            this.logger.warn(
              `"${source.name}" needs manual confirmation: the sheet grew beyond the ` +
                'safety threshold. No changes were applied.',
            );
          }
        } catch (err) {
          // One unreachable sheet must not stop the rest, and must never
          // affect data already in the database.
          this.logger.error(
            `Scheduled sync of "${source.name}" failed: ${(err as Error).message}`,
          );
        }
      });
    }
  }
}
