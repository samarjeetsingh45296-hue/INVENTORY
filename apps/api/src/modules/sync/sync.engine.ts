import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  SourceType,
  SyncMode,
  SyncRowStatus,
  SyncStatus,
} from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequestContextStore } from '../../common/context/request-context';
import { stableRowHash, randomToken } from '../../common/utils/crypto.util';
import { GoogleSheetsAdapter } from './adapters/google-sheets.adapter';
import { FileAdapter } from './adapters/file.adapter';
import { SourceRow, SourceTable } from './adapters/source-adapter';
import { applyTransform, TransformName } from './transform';
import { EntityWriter, WriteContext, reconcile } from './writers/entity-writer';
import { EmployeeWriter } from './writers/employee.writer';
import { AssetWriter } from './writers/asset.writer';

export interface RunOptions {
  sourceId: string;
  dryRun: boolean;
  confirmationToken?: string;
  /** For uploaded files rather than a Google tab. */
  filePath?: string;
}

interface PreparedRow {
  source: SourceRow;
  rowHash: string;
  normalized: Record<string, unknown>;
  dedupeKey: string | null;
  errors: string[];
}

@Injectable()
export class SyncEngine {
  private readonly logger = new Logger(SyncEngine.name);
  private readonly writers = new Map<string, EntityWriter>();

  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly sheets: GoogleSheetsAdapter,
    private readonly files: FileAdapter,
    employeeWriter: EmployeeWriter,
    assetWriter: AssetWriter,
  ) {
    for (const w of [employeeWriter, assetWriter]) this.writers.set(w.entity, w);
  }

  /**
   * Runs one sync.
   *
   * Nothing is ever deleted. A row that has vanished from the sheet since the
   * last run is simply not mentioned - the database keeps it, because the
   * database is the record, not the sheet.
   */
  async run(opts: RunOptions) {
    const source = await this.prisma.syncSource.findFirst({
      where: { id: opts.sourceId },
      include: { mappings: true },
    });
    if (!source) throw new NotFoundException('Sync source not found');

    if (source.isDisconnected) {
      throw new BadRequestException(
        `"${source.name}" was disconnected on ` +
          `${source.disconnectedAt?.toISOString().slice(0, 10)} after a one-time migration. ` +
          'Its data is already in the database. Reconnect it explicitly if you really want to import again.',
      );
    }

    const writer = this.writers.get(source.targetEntity);
    if (!writer) {
      throw new BadRequestException(
        `No importer is registered for "${source.targetEntity}". ` +
          `Available: ${[...this.writers.keys()].join(', ')}`,
      );
    }

    const ctx = RequestContextStore.get();
    const run = await this.prisma.syncRun.create({
      data: {
        sourceId: source.id,
        mode: source.mode,
        status: SyncStatus.RUNNING,
        dryRun: opts.dryRun || source.dryRunDefault,
        triggeredById: ctx.userId,
        triggeredByName: ctx.userName,
      },
    });

    try {
      const table = await this.readSource(source, opts.filePath);
      this.realtime.syncProgress(run.id, { phase: 'read', rows: table.rows.length });

      const prepared = this.prepareRows(table, source, writer);

      // A run that would touch an unusually large number of rows pauses for a
      // human rather than applying a huge change unattended.
      const limit = Number(process.env.SYNC_MAX_ROWS_PER_RUN ?? 20000);
      if (
        table.rows.length > limit &&
        !opts.confirmationToken &&
        !run.dryRun
      ) {
        const token = randomToken(16);
        await this.prisma.syncRun.update({
          where: { id: run.id },
          data: {
            status: SyncStatus.AWAITING_CONFIRMATION,
            rowsRead: table.rows.length,
            confirmationToken: token,
            finishedAt: new Date(),
          },
        });
        return {
          runId: run.id,
          status: SyncStatus.AWAITING_CONFIRMATION,
          rowsRead: table.rows.length,
          confirmationToken: token,
          message:
            `This sheet has ${table.rows.length} rows, more than the ${limit}-row ` +
            'safety threshold. Review the preview and confirm to proceed.',
        };
      }

      const result = await this.applyRows(run.id, source, writer, prepared);

      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: result.rowsInvalid > 0 || result.rowsConflict > 0
            ? SyncStatus.PARTIAL
            : SyncStatus.SUCCESS,
          finishedAt: new Date(),
          durationMs: Date.now() - run.startedAt.getTime(),
          ...result,
        },
      });

      await this.prisma.syncSource.update({
        where: { id: source.id },
        data: {
          lastRunAt: new Date(),
          lastSuccessAt: new Date(),
          lastRowCount: result.rowsRead,
          lastError: null,
          ...(source.mode === SyncMode.ONE_TIME_MIGRATION && !run.dryRun
            ? {
                isDisconnected: true,
                disconnectedAt: new Date(),
                disconnectedById: ctx.userId,
              }
            : {}),
        },
      });

      await this.audit.record({
        action: AuditAction.SYNC,
        entityType: 'SyncSource',
        entityId: source.id,
        entityLabel: source.name,
        summary:
          `${run.dryRun ? 'Previewed' : 'Imported'} ${result.rowsRead} rows: ` +
          `${result.rowsNew} new, ${result.rowsUpdated} updated, ` +
          `${result.rowsUnchanged} unchanged, ${result.rowsInvalid} invalid, ` +
          `${result.rowsConflict} conflicts`,
        refType: 'SyncRun',
        refId: run.id,
      });

      this.realtime.syncCompleted(run.id, { ...result, sourceName: source.name });
      return { runId: run.id, status: SyncStatus.SUCCESS, ...result };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Sync run ${run.id} failed: ${message}`, (err as Error).stack);

      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: SyncStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: message,
        },
      });
      await this.prisma.syncSource.update({
        where: { id: source.id },
        data: { lastRunAt: new Date(), lastError: message },
      });

      // A failed read leaves every existing record untouched.
      throw err;
    }
  }

  // ------------------------------------------------------------ reading ----

  private async readSource(
    source: { sourceType: SourceType; spreadsheetId: string | null; sheetGid: string | null; sheetName: string | null; headerRow: number },
    filePath?: string,
  ): Promise<SourceTable> {
    if (source.sourceType === SourceType.GOOGLE_SHEET) {
      return this.sheets.read({
        spreadsheetId: source.spreadsheetId,
        sheetGid: source.sheetGid,
        sheetName: source.sheetName,
        headerRow: source.headerRow,
      });
    }
    return this.files.read({
      filePath: filePath ?? null,
      sheetName: source.sheetName,
      headerRow: source.headerRow,
    });
  }

  // --------------------------------------------------------- preparation ----

  /**
   * Maps, transforms and validates every row before a single write happens,
   * so a bad sheet is reported in full rather than half-applied.
   */
  private prepareRows(
    table: SourceTable,
    source: {
      mappings: Array<{
        sourceHeader: string;
        targetField: string;
        transform: string;
        transformArg: unknown;
        isRequired: boolean;
        defaultValue: string | null;
        isIgnored: boolean;
      }>;
      dedupeKeys: string[];
    },
    writer: EntityWriter,
  ): PreparedRow[] {
    const mappings = source.mappings.filter((m) => !m.isIgnored);

    // Warn loudly when the sheet no longer contains a mapped column: that is
    // usually a renamed header, and silently importing nulls would be worse
    // than stopping to say so.
    const missing = mappings
      .filter((m) => m.isRequired && !table.headers.includes(m.sourceHeader))
      .map((m) => m.sourceHeader);
    if (missing.length) {
      throw new BadRequestException(
        `These required columns are not in the sheet any more: ${missing.join(', ')}. ` +
          'Update the column mapping for this source, then run the sync again. ' +
          'No data has been changed.',
      );
    }

    return table.rows.map((row) => {
      const normalized: Record<string, unknown> = {};
      const errors: string[] = [];

      for (const m of mappings) {
        const cell = row.raw[m.sourceHeader] ?? '';
        const result = applyTransform(
          m.transform as TransformName,
          cell,
          (m.transformArg as Record<string, unknown>) ?? {},
        );

        if (!result.ok) {
          errors.push(`${m.sourceHeader}: ${result.error}`);
          continue;
        }

        let value = result.value;
        if ((value === null || value === '') && m.defaultValue !== null) {
          value = m.defaultValue;
        }
        if (m.isRequired && (value === null || value === '')) {
          errors.push(`${m.sourceHeader} is required but empty`);
        }
        if (value !== null) normalized[m.targetField] = value;
      }

      errors.push(...writer.validate(normalized));

      return {
        source: row,
        rowHash: stableRowHash(row.raw),
        normalized,
        dedupeKey: writer.dedupeKey(normalized, source.dedupeKeys),
        errors,
      };
    });
  }

  // ------------------------------------------------------------ applying ----

  private async applyRows(
    runId: string,
    source: {
      id: string;
      name: string;
      allowUpdates: boolean;
      lastSuccessAt: Date | null;
      dedupeKeys: string[];
    },
    writer: EntityWriter,
    prepared: PreparedRow[],
  ) {
    const counts = {
      rowsRead: prepared.length,
      rowsNew: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsDuplicate: 0,
      rowsInvalid: 0,
      rowsConflict: 0,
      rowsSkipped: 0,
    };

    const run = await this.prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
    const dryRun = run.dryRun;

    const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) throw new BadRequestException('No organisation is set up yet. Run the seed first.');
    const defaultBranch = await this.prisma.branch.findFirst({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'asc' },
    });

    const ctx = RequestContextStore.get();
    const writeCtx: WriteContext = {
      runId,
      sourceRef: `${source.name}#run:${runId}`,
      organizationId: org.id,
      defaultBranchId: defaultBranch?.id ?? null,
      actorUserId: ctx.userId,
    };

    // Rows already seen in THIS sheet, so a duplicate inside the file is
    // reported rather than applied twice.
    const seenInBatch = new Set<string>();
    const stagingRows: Array<Record<string, unknown>> = [];

    for (const [index, row] of prepared.entries()) {
      const base = {
        runId,
        rowNumber: row.source.rowNumber,
        rawData: row.source.raw as object,
        rowHash: row.rowHash,
        dedupeKey: row.dedupeKey,
        entityType: writer.entity,
      };

      if (row.errors.length) {
        counts.rowsInvalid++;
        stagingRows.push({
          ...base,
          status: SyncRowStatus.INVALID,
          normalized: row.normalized as object,
          messages: row.errors,
        });
        continue;
      }

      if (!row.dedupeKey) {
        counts.rowsInvalid++;
        stagingRows.push({
          ...base,
          status: SyncRowStatus.INVALID,
          messages: [`Row has no value for the identifying column(s): ${source.dedupeKeys.join(', ')}`],
        });
        continue;
      }

      if (seenInBatch.has(row.dedupeKey)) {
        counts.rowsDuplicate++;
        stagingRows.push({
          ...base,
          status: SyncRowStatus.DUPLICATE,
          messages: [`"${row.dedupeKey}" appears more than once in this sheet; only the first was used`],
        });
        continue;
      }
      seenInBatch.add(row.dedupeKey);

      try {
        const outcome = await this.applyOne(row, writer, writeCtx, source, dryRun);
        counts[outcome.counter]++;
        stagingRows.push({
          ...base,
          status: outcome.status,
          normalized: row.normalized as object,
          entityId: outcome.entityId ?? null,
          messages: outcome.messages,
        });
      } catch (err) {
        counts.rowsInvalid++;
        stagingRows.push({
          ...base,
          status: SyncRowStatus.INVALID,
          normalized: row.normalized as object,
          messages: [`Could not import: ${(err as Error).message}`],
        });
      }

      if ((index + 1) % 100 === 0) {
        this.realtime.syncProgress(runId, {
          phase: 'apply',
          done: index + 1,
          total: prepared.length,
        });
      }
    }

    // The raw archive is written even for a dry run, so a preview still leaves
    // a permanent copy of what the sheet contained at that moment.
    for (let i = 0; i < stagingRows.length; i += 500) {
      await this.prisma.syncRow.createMany({
        data: stagingRows.slice(i, i + 500) as never,
      });
    }

    return counts;
  }

  /**
   * Decides what to do with a single row and does it, inside its own
   * transaction so one bad row cannot poison the rest of the import.
   */
  private async applyOne(
    row: PreparedRow,
    writer: EntityWriter,
    writeCtx: WriteContext,
    source: { allowUpdates: boolean; lastSuccessAt: Date | null },
    dryRun: boolean,
  ): Promise<{
    status: SyncRowStatus;
    counter: 'rowsNew' | 'rowsUpdated' | 'rowsUnchanged' | 'rowsConflict' | 'rowsSkipped';
    entityId?: string;
    messages: string[];
  }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await writer.findExisting(tx as never, row.dedupeKey!, writeCtx);

      // ---- brand new record -------------------------------------------
      if (!existing) {
        if (dryRun) {
          return {
            status: SyncRowStatus.NEW,
            counter: 'rowsNew' as const,
            messages: ['Would be created'],
          };
        }
        const created = await writer.create(tx as never, row.normalized, writeCtx);
        return {
          status: SyncRowStatus.IMPORTED,
          counter: 'rowsNew' as const,
          entityId: created.id,
          messages: [`Created ${created.label}`],
        };
      }

      // ---- existing record --------------------------------------------
      if (!source.allowUpdates) {
        return {
          status: SyncRowStatus.SKIPPED,
          counter: 'rowsSkipped' as const,
          entityId: existing.id,
          messages: ['Already exists; this source is set to insert-only'],
        };
      }

      // The database is master: a field a person edited after the last import
      // is never silently overwritten by the sheet.
      const { safe, conflicts } = reconcile(
        row.normalized,
        existing,
        source.lastSuccessAt,
        true,
      );

      if (conflicts.length > 0) {
        return {
          status: SyncRowStatus.CONFLICT,
          counter: 'rowsConflict' as const,
          entityId: existing.id,
          messages: [
            `Kept the value entered in the website for: ${conflicts.join(', ')}. ` +
              'The sheet has different values, but these fields were edited here more ' +
              'recently. Resolve them from the sync report if the sheet is correct.',
          ],
        };
      }

      if (Object.keys(safe).length === 0) {
        return {
          status: SyncRowStatus.UNCHANGED,
          counter: 'rowsUnchanged' as const,
          entityId: existing.id,
          messages: [],
        };
      }

      if (dryRun) {
        return {
          status: SyncRowStatus.UPDATED,
          counter: 'rowsUpdated' as const,
          entityId: existing.id,
          messages: [`Would update: ${Object.keys(safe).join(', ')}`],
        };
      }

      const updated = await writer.update(tx as never, existing, safe, writeCtx);
      await this.audit.record({
        action: AuditAction.SYNC,
        entityType: writer.entity,
        entityId: updated.id,
        entityLabel: updated.label,
        oldValue: Object.fromEntries(
          updated.changed.map((k) => [k, existing.snapshot[k] ?? null]),
        ),
        newValue: safe,
        summary: `Updated from sheet import (${updated.changed.join(', ')})`,
        refType: 'SyncRun',
        refId: writeCtx.runId,
      });

      return {
        status: SyncRowStatus.UPDATED,
        counter: 'rowsUpdated' as const,
        entityId: updated.id,
        messages: [`Updated: ${updated.changed.join(', ')}`],
      };
    });
  }
}
