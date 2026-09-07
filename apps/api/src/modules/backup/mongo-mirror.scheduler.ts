import { Injectable, Logger } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextStore } from '../../common/context/request-context';
import { mirrorToMongo } from './mongo-mirror';

/**
 * Keeps the MongoDB copy fresh.
 *
 * Every night (MONGO_MIRROR_CRON, 01:30 IST by default) and once shortly
 * after the API starts, everything in PostgreSQL is mirrored into MongoDB.
 * A failure is logged and written to the change history, never thrown:
 * the website must not care whether the mirror is reachable.
 */
@Injectable()
export class MongoMirrorScheduler {
  private readonly logger = new Logger(MongoMirrorScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(process.env.MONGO_MIRROR_CRON ?? '30 1 * * *', {
    name: 'mongo-mirror-nightly',
    timeZone: process.env.TZ ?? 'Asia/Kolkata',
  })
  nightly(): Promise<void> {
    return this.run('nightly-mirror');
  }

  /** Two minutes after boot, so a fresh deployment has its copy the same day. */
  @Timeout(2 * 60 * 1000)
  onBoot(): Promise<void> {
    return this.run('startup-mirror');
  }

  async run(reason: string): Promise<void> {
    if (process.env.MONGO_MIRROR_ENABLED === 'false') return;
    await RequestContextStore.runAsSystem(reason, async () => {
      try {
        const result = await mirrorToMongo(this.prisma, {
          log: (line) => this.logger.log(line),
        });
        const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
        await this.audit.record({
          action: AuditAction.BACKUP,
          entityType: 'MongoMirror',
          entityLabel: result.db,
          summary:
            `MongoDB copy refreshed (${total.toLocaleString()} documents across ` +
            `${Object.keys(result.counts).length} collections, ${Math.round(result.durationMs / 1000)}s)` +
            (result.mismatches.length ? ` - MISMATCH: ${result.mismatches.join('; ')}` : ''),
        });
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(`MongoDB mirror failed: ${message}`);
        await this.audit
          .record({
            action: AuditAction.BACKUP,
            entityType: 'MongoMirror',
            summary: `MONGODB COPY FAILED: ${message}`,
          })
          .catch(() => undefined);
      }
    });
  }
}
