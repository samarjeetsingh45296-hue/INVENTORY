import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BackupService } from './backup.service';
import { RequestContextStore } from '../../common/context/request-context';

/**
 * Nightly and weekly backups.
 *
 * Cron expressions come from the environment so the window can be moved
 * without a redeploy. Both jobs run under a named system identity, so the
 * audit trail shows "System (nightly-backup)" rather than a blank actor.
 */
@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name);

  constructor(private readonly backup: BackupService) {}

  @Cron(process.env.BACKUP_DAILY_CRON ?? '0 1 * * *', {
    name: 'nightly-backup',
    timeZone: process.env.TZ ?? 'Asia/Kolkata',
  })
  async nightly(): Promise<void> {
    await RequestContextStore.runAsSystem('nightly-backup', async () => {
      try {
        await this.backup.createBackup({ type: 'DAILY', reason: 'Scheduled nightly backup' });
        await this.backup.pruneExpired();
      } catch (err) {
        this.logger.error(`Nightly backup failed: ${(err as Error).message}`);
      }
    });
  }

  @Cron(process.env.BACKUP_WEEKLY_CRON ?? '0 3 * * 0', {
    name: 'weekly-archive',
    timeZone: process.env.TZ ?? 'Asia/Kolkata',
  })
  async weekly(): Promise<void> {
    await RequestContextStore.runAsSystem('weekly-archive', async () => {
      try {
        await this.backup.createBackup({ type: 'WEEKLY', reason: 'Scheduled weekly archive' });
      } catch (err) {
        this.logger.error(`Weekly archive failed: ${(err as Error).message}`);
      }
    });
  }

  /** Daily consistency check between the backup table and the files on disk. */
  @Cron('30 4 * * *', { name: 'backup-integrity', timeZone: process.env.TZ ?? 'Asia/Kolkata' })
  async verify(): Promise<void> {
    await RequestContextStore.runAsSystem('backup-integrity', async () => {
      const report = await this.backup.verifyIntegrity();
      if (report.missingFiles.length) {
        this.logger.error(
          `Backup files missing from disk: ${report.missingFiles.join(', ')}`,
        );
      }
    });
  }
}
