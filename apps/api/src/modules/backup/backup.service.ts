import { Inject, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  AuditAction,
  BackupFormat,
  BackupStatus,
  BackupType,
} from '@prisma/client';
import { PRISMA, ExtendedPrisma, PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequestContextStore } from '../../common/context/request-context';

export interface CreateBackupOptions {
  type: keyof typeof BackupType;
  reason?: string;
}

/**
 * Database backups.
 *
 * Daily dumps are kept for 90 days and weekly archives for a year, matching
 * the specified retention. Every run records a row count per table alongside
 * the dump, so silent data loss shows up as a falling count between two
 * consecutive backups instead of being discovered months later.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly raw: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private get backupDir(): string {
    return resolve(process.env.BACKUP_DIR ?? './backups');
  }

  async createBackup(opts: CreateBackupOptions) {
    const ctx = RequestContextStore.get();
    const type = BackupType[opts.type];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `inventory-${type.toLowerCase()}-${stamp}.dump`;

    await mkdir(this.backupDir, { recursive: true });
    const filePath = join(this.backupDir, fileName);

    const run = await this.prisma.backupRun.create({
      data: {
        type,
        format: BackupFormat.PG_DUMP,
        status: BackupStatus.RUNNING,
        fileName,
        filePath,
        triggeredById: ctx.userId,
        triggeredByName: ctx.userName,
        retainUntil: this.retentionFor(type),
      },
    });

    try {
      const counts = await this.raw.tableCounts();
      await this.runPgDump(filePath);

      const [size, checksum] = await Promise.all([
        stat(filePath).then((s) => s.size),
        this.sha256File(filePath),
      ]);

      const finished = await this.prisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: BackupStatus.SUCCESS,
          finishedAt: new Date(),
          durationMs: Date.now() - run.startedAt.getTime(),
          sizeBytes: BigInt(size),
          checksumSha256: checksum,
          tableCounts: counts,
        },
      });

      await this.audit.record({
        action: AuditAction.BACKUP,
        entityType: 'BackupRun',
        entityId: run.id,
        entityLabel: fileName,
        summary:
          `${type} backup completed (${(size / 1024 / 1024).toFixed(1)} MB)` +
          (opts.reason ? ` - ${opts.reason}` : ''),
      });

      this.realtime.backupCompleted({ id: finished.id, type, fileName, sizeBytes: size });
      this.logger.log(`${type} backup written to ${filePath} (${size} bytes)`);
      return { ...finished, sizeBytes: size };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Backup failed: ${message}`);

      await this.prisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: BackupStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: message,
        },
      });
      // A failed backup is an operational emergency, not a silent no-op.
      await this.audit.record({
        action: AuditAction.BACKUP,
        entityType: 'BackupRun',
        entityId: run.id,
        summary: `BACKUP FAILED: ${message}`,
      });
      throw err;
    }
  }

  /**
   * Custom-format dump (-Fc): compressed, and restorable table-by-table with
   * pg_restore rather than all-or-nothing.
   */
  private runPgDump(filePath: string): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');

    const bin = process.env.PG_DUMP_PATH ?? 'pg_dump';
    const args = [
      '--format=custom',
      '--compress=6',
      '--no-owner',
      '--no-privileges',
      '--file',
      filePath,
      url,
    ];

    return new Promise((done, fail) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('error', (e) =>
        fail(
          new Error(
            `Could not run "${bin}" (${e.message}). Install the PostgreSQL client ` +
              'tools, or point PG_DUMP_PATH at them.',
          ),
        ),
      );
      child.on('close', (code) =>
        code === 0
          ? done()
          : fail(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`)),
      );
    });
  }

  private retentionFor(type: BackupType): Date {
    const days =
      type === BackupType.WEEKLY
        ? Number(process.env.BACKUP_WEEKLY_RETENTION ?? 52) * 7
        : type === BackupType.DAILY
          ? Number(process.env.BACKUP_DAILY_RETENTION ?? 90)
          : 365;
    return new Date(Date.now() + days * 86_400_000);
  }

  private sha256File(filePath: string): Promise<string> {
    return new Promise((done, fail) => {
      const hash = createHash('sha256');
      createReadStream(filePath)
        .on('data', (c) => hash.update(c))
        .on('end', () => done(hash.digest('hex')))
        .on('error', fail);
    });
  }

  /**
   * Removes dumps past their retention date. Only ever deletes a file whose
   * BackupRun row says it has expired, and always keeps the newest few of each
   * type regardless, so a wrong system clock cannot wipe every backup.
   */
  async pruneExpired(): Promise<{ pruned: number; kept: number }> {
    const now = new Date();
    const MIN_KEEP = 7;
    let pruned = 0;

    for (const type of [BackupType.DAILY, BackupType.WEEKLY] as const) {
      const runs = await this.prisma.backupRun.findMany({
        where: { type, status: BackupStatus.SUCCESS, prunedAt: null },
        orderBy: { startedAt: 'desc' },
      });

      const expired = runs
        .slice(MIN_KEEP)
        .filter((r) => r.retainUntil !== null && r.retainUntil < now);

      for (const run of expired) {
        if (run.filePath) {
          await unlink(run.filePath).catch((e: Error) =>
            this.logger.warn(`Could not delete ${run.filePath}: ${e.message}`),
          );
        }
        await this.prisma.backupRun.update({
          where: { id: run.id },
          data: { status: BackupStatus.PRUNED, prunedAt: now },
        });
        pruned++;
      }
    }

    const kept = await this.prisma.backupRun.count({
      where: { status: BackupStatus.SUCCESS },
    });
    if (pruned) this.logger.log(`Pruned ${pruned} expired backups, ${kept} retained`);
    return { pruned, kept };
  }

  async list(take = 50) {
    const rows = await this.prisma.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take,
    });
    // BigInt does not survive JSON serialisation.
    return rows.map((r) => ({
      ...r,
      sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
    }));
  }

  /** Cross-checks the backup table against what is actually on disk. */
  async verifyIntegrity() {
    const runs = await this.prisma.backupRun.findMany({
      where: { status: BackupStatus.SUCCESS },
    });
    const onDisk = await readdir(this.backupDir).catch(() => [] as string[]);

    const missingFiles = runs
      .filter((r) => r.fileName && !onDisk.includes(r.fileName))
      .map((r) => r.fileName as string);

    const orphanFiles = onDisk.filter(
      (f) => f.endsWith('.dump') && !runs.some((r) => r.fileName === f),
    );

    return { expected: runs.length, onDisk: onDisk.length, missingFiles, orphanFiles };
  }
}
