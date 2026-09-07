import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestContextStore } from '../../common/context/request-context';
import { ReconcileService } from './reconcile.service';

/**
 * Four validation cycles a day - 09:00, 12:00, 15:00 and 18:00 IST by
 * default (RECONCILE_CRON) - each reading the master workbooks, applying
 * them, and checking the database against them.
 */
@Injectable()
export class ReconcileScheduler {
  private readonly logger = new Logger(ReconcileScheduler.name);

  constructor(private readonly reconcile: ReconcileService) {}

  @Cron(process.env.RECONCILE_CRON ?? '0 9,12,15,18 * * *', {
    name: 'reconcile-scheduled',
    timeZone: process.env.TZ ?? 'Asia/Kolkata',
  })
  async scheduled(): Promise<void> {
    if (process.env.RECONCILE_ENABLED === 'false') return;
    await RequestContextStore.runAsSystem('reconciliation', async () => {
      try {
        const { id } = await this.reconcile.run('scheduled');
        this.logger.log(`Reconciliation run ${id} finished`);
      } catch (err) {
        this.logger.error(`Reconciliation failed: ${(err as Error).message}`);
      }
    });
  }
}
