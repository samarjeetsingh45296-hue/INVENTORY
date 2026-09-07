import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { WS_EVENTS } from '@inventory/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequestContextStore } from '../../common/context/request-context';
import { GoogleSheetsAdapter } from '../sync/adapters/google-sheets.adapter';
import { keepCopy, resolveSources } from './sheet-source';
import { runCccImport } from './importers/ccc';
import { runWingwiseImport } from './importers/wingwise';

/** One exception list on the dashboard: how many, and the first few. */
export interface Finding {
  count: number;
  items: Array<Record<string, unknown>>;
}

export type Exceptions = Record<string, Finding>;

const CAP = 100;
const finding = (items: Array<Record<string, unknown>>, count = items.length): Finding =>
  ({ count, items: items.slice(0, CAP) });

/**
 * The reconciliation engine.
 *
 * Four times a day (and on demand) it reads the master workbooks - live
 * from Google when a key is present, else the last copies supplied - and
 * applies them: a person or asset the sheet has and the site lacks is
 * created, a new assignment attached, a seat's process and gaps refreshed.
 * Then it checks the database against what it just read and against
 * itself: duplicates, mismatched holders, missing model numbers and serials,
 * orphaned records, people with nothing or with several computers, and
 * anything the sheet no longer lists. What it can fix safely it fixes and
 * counts; the rest it lists for review. Nothing is ever deleted.
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly sheets: GoogleSheetsAdapter,
  ) {}

  /** The latest run, the recent ones, and the last time the sheets were read. */
  async latest() {
    const [latest, recent, lastSync] = await Promise.all([
      this.prisma.reconciliationRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.reconciliationRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 30,
        select: { id: true, status: true, startedAt: true, finishedAt: true, durationMs: true, trigger: true, sheetConnected: true, summary: true },
      }),
      this.prisma.syncRun.findFirst({
        where: { dryRun: false, status: { in: ['SUCCESS', 'PARTIAL'] } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, source: { select: { name: true, workbookLabel: true } } },
      }),
    ]);
    const finished = recent.filter((r) => r.status !== 'RUNNING');
    const ok = finished.filter((r) => r.status === 'SUCCESS').length;
    return {
      latest,
      recent,
      lastSyncAt: lastSync?.startedAt ?? null,
      lastSyncSource: lastSync?.source ?? null,
      successRate: finished.length ? Math.round((ok / finished.length) * 100) : null,
      running: this.running,
      schedule: process.env.RECONCILE_CRON ?? '0 9,12,15,18 * * *',
    };
  }

  /** One full pass. Serialised: a second call while one runs returns the first. */
  async run(trigger: string): Promise<{ id: string }> {
    if (this.running) {
      const current = await this.prisma.reconciliationRun.findFirst({
        where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' },
      });
      if (current) return { id: current.id };
    }
    this.running = true;
    const ctx = RequestContextStore.get();
    const run = await this.prisma.reconciliationRun.create({
      data: { trigger, triggeredById: ctx.userId, triggeredByName: ctx.userName },
    });
    const log = (line: string) => this.logger.log(line);
    const summary: Record<string, unknown> = {};
    const exceptions: Exceptions = {};
    const problems: string[] = [];

    try {
      // ------------------------------------------------ 1. read and apply --
      const sources = await resolveSources(this.prisma, this.sheets);
      summary.sheetConnected = sources.connected;
      if (sources.reason) problems.push(sources.reason);

      let seenAssetKeys: Set<string> | null = null;
      let cccRunId: string | null = null;
      let wingRunId: string | null = null;

      if (sources.ccc) {
        try {
          const r = await runCccImport(this.prisma, sources.ccc, {
            triggeredBy: `Reconciliation (${trigger})`, actorId: ctx.userId ?? null, log,
          });
          cccRunId = r.runId;
          seenAssetKeys = r.seen;
          summary.ccc = { ...r.counts, tabsFailed: r.tabsFailed };
          if (sources.ccc.kind === 'file') summary.cccKeptCopy = keepCopy(sources.ccc.label, 'central-contact-center');
          if (r.tabsFailed.length) problems.push(`Contact Center workbook: ${r.tabsFailed.join('; ')}`);
        } catch (err) {
          problems.push(`Contact Center workbook could not be read: ${(err as Error).message}`);
        }
      } else {
        problems.push('Contact Center workbook: no source available to read.');
      }

      if (sources.wingwise) {
        try {
          const r = await runWingwiseImport(this.prisma, sources.wingwise, {
            triggeredBy: `Reconciliation (${trigger})`, log,
          });
          wingRunId = r.runId;
          summary.wingwise = { ...r.counts, seats: r.seats.size, tabsFailed: r.tabsFailed };
          if (sources.wingwise.kind === 'file') summary.wingwiseKeptCopy = keepCopy(sources.wingwise.label, 'wing-wise');
          if (r.tabsFailed.length) problems.push(`Wing Wise workbook: ${r.tabsFailed.join('; ')}`);
        } catch (err) {
          problems.push(`Wing Wise workbook could not be read: ${(err as Error).message}`);
        }
      } else {
        problems.push('Wing Wise workbook: no source available to read.');
      }

      // ------------------------------------------------------- 2. correct --
      summary.corrected = await this.autoCorrect();

      // --------------------------------------------------------- 3. check --
      Object.assign(exceptions, await this.check(seenAssetKeys));
      summary.exceptionCounts = Object.fromEntries(
        Object.entries(exceptions).map(([k, v]) => [k, v.count]),
      );
      summary.problems = problems;

      const status = problems.length ? 'PARTIAL' : 'SUCCESS';
      const finished = await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          durationMs: Date.now() - run.startedAt.getTime(),
          sheetConnected: sources.connected,
          sourceNote: sources.connected
            ? 'Read live from Google Sheets'
            : [sources.ccc?.label, sources.wingwise?.label].filter(Boolean).join(' | ') || null,
          cccRunId,
          wingwiseRunId: wingRunId,
          summary: summary as Prisma.InputJsonValue,
          exceptions: exceptions as unknown as Prisma.InputJsonValue,
        },
      });

      const total = Object.values(exceptions).reduce((a, f) => a + f.count, 0);
      await this.audit.record({
        action: AuditAction.IMPORT,
        entityType: 'ReconciliationRun',
        entityId: run.id,
        entityLabel: trigger,
        summary:
          `Reconciliation ${status.toLowerCase()}: ${total} exception(s) across ` +
          `${Object.keys(exceptions).length} checks` +
          (sources.connected ? ', sheets read live' : ', sheets not connected - last workbook files used'),
      });
      this.realtime.emitChange({
        event: WS_EVENTS.SYNC_COMPLETED,
        entityType: 'ReconciliationRun',
        entityId: run.id,
        branchId: null,
        actorName: 'Reconciliation',
        data: { status, total },
      });
      return { id: finished.id };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Reconciliation failed: ${message}`);
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED', finishedAt: new Date(), errorMessage: message,
          durationMs: Date.now() - run.startedAt.getTime(),
          summary: summary as Prisma.InputJsonValue,
        },
      });
      await this.audit.record({
        action: AuditAction.IMPORT, entityType: 'ReconciliationRun', entityId: run.id,
        summary: `RECONCILIATION FAILED: ${message}`,
      }).catch(() => undefined);
      return { id: run.id };
    } finally {
      this.running = false;
    }
  }

  /**
   * Fixes that are safe because the allocation records are the truth:
   * an asset's holder pointer and status follow its active allocation.
   */
  private async autoCorrect(): Promise<Record<string, number>> {
    const holderPointer = await this.prisma.$executeRawUnsafe(`
      UPDATE assets a SET "currentHolderEmployeeId" = al."employeeId", "currentAllocationId" = al.id,
                          status = CASE WHEN a.status = 'IN_STOCK' THEN 'ALLOCATED' ELSE a.status END
      FROM asset_allocations al
      WHERE al."assetId" = a.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL AND al."holderType" = 'EMPLOYEE'
        AND a."deletedAt" IS NULL
        AND (a."currentHolderEmployeeId" IS DISTINCT FROM al."employeeId" OR a."currentAllocationId" IS DISTINCT FROM al.id)
    `);
    const stalePointer = await this.prisma.$executeRawUnsafe(`
      UPDATE assets a SET "currentHolderEmployeeId" = NULL, "currentAllocationId" = NULL,
                          status = CASE WHEN a.status = 'ALLOCATED' THEN 'IN_STOCK' ELSE a.status END
      WHERE a."deletedAt" IS NULL
        AND (a."currentHolderEmployeeId" IS NOT NULL OR a."currentAllocationId" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM asset_allocations al WHERE al."assetId" = a.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL)
    `);
    return { holderPointerFixed: holderPointer, stalePointerCleared: stalePointer };
  }

  /** Every check on the dashboard. Each returns a count and the first rows. */
  private async check(seenAssetKeys: Set<string> | null): Promise<Exceptions> {
    const q = <T = Record<string, unknown>>(sql: string) => this.prisma.$queryRawUnsafe<T[]>(sql);
    const out: Exceptions = {};

    // Assets the sheet lists that the site did not have: created this run.
    // (The import's own count is the truth; listed here from the run rows.)
    const createdRows = await q(`
      SELECT a."assetTag" AS "assetId", c.name AS category, a.make, a.model, a."serialNumber" AS serial
      FROM assets a JOIN asset_categories c ON c.id = a."categoryId"
      WHERE a."deletedAt" IS NULL AND a."createdAt" > now() - interval '15 minutes'
        AND a."sourceRef" LIKE 'ccc:%' ORDER BY a."createdAt" DESC LIMIT ${CAP}`);
    const createdCount = await q<{ n: number }>(`
      SELECT count(*)::int AS n FROM assets a WHERE a."deletedAt" IS NULL
        AND a."createdAt" > now() - interval '15 minutes' AND a."sourceRef" LIKE 'ccc:%'`);
    out.assetsMissingFromWebsite = finding(createdRows, createdCount[0]?.n ?? 0);

    // Assets the site has from the sheet that the sheet no longer lists:
    // flagged, never removed.
    if (seenAssetKeys) {
      const fromSheet = await this.prisma.asset.findMany({
        where: { deletedAt: null, sourceRef: { startsWith: 'ccc:' } },
        select: { assetTag: true, sourceRef: true, make: true, model: true, serialNumber: true, category: { select: { name: true } } },
      });
      const gone = fromSheet.filter((a) => a.sourceRef && !seenAssetKeys.has(a.sourceRef));
      out.assetsMissingFromSheet = finding(gone.map((a) => ({
        assetId: a.assetTag, category: a.category.name, make: a.make, model: a.model,
        serial: a.serialNumber, sheetRow: a.sourceRef,
      })));
    } else {
      out.assetsMissingFromSheet = finding([]);
    }

    out.duplicateAssets = finding(await q(`
      SELECT a."serialNumber" AS serial, string_agg(a."assetTag", ', ' ORDER BY a."assetTag") AS "assetIds", count(*)::int AS copies
      FROM assets a WHERE a."deletedAt" IS NULL AND a."serialNumber" IS NOT NULL AND a."serialNumber" <> ''
      GROUP BY a."serialNumber" HAVING count(*) > 1 ORDER BY copies DESC LIMIT ${CAP}`));

    out.assignmentMismatches = finding(await q(`
      SELECT a."assetTag" AS "assetId", c.name AS category, a.status,
             (SELECT count(*)::int FROM asset_allocations al WHERE al."assetId" = a.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL) AS "activeAllocations",
             CASE WHEN a.status = 'ALLOCATED' THEN 'marked allocated but held by no one' ELSE 'held by someone but not marked allocated' END AS problem
      FROM assets a JOIN asset_categories c ON c.id = a."categoryId"
      WHERE a."deletedAt" IS NULL AND (
        (a.status = 'ALLOCATED' AND NOT EXISTS (SELECT 1 FROM asset_allocations al WHERE al."assetId" = a.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL))
        OR (a.status = 'IN_STOCK' AND EXISTS (SELECT 1 FROM asset_allocations al WHERE al."assetId" = a.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL))
        OR (SELECT count(*) FROM asset_allocations al WHERE al."assetId" = a.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL) > 1
      ) LIMIT ${CAP}`));

    const unassignedCount = await q<{ n: number }>(`SELECT count(*)::int AS n FROM assets WHERE "deletedAt" IS NULL AND status = 'IN_STOCK'`);
    out.unassignedAssets = finding(await q(`
      SELECT a."assetTag" AS "assetId", c.name AS category, a.make, a.model, a."serialNumber" AS serial
      FROM assets a JOIN asset_categories c ON c.id = a."categoryId"
      WHERE a."deletedAt" IS NULL AND a.status = 'IN_STOCK' ORDER BY c.name, a."assetTag" LIMIT ${CAP}`), unassignedCount[0]?.n ?? 0);

    const noKitCount = await q<{ n: number }>(`
      SELECT count(*)::int AS n FROM employees e WHERE e."deletedAt" IS NULL AND e."employmentStatus" = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM asset_allocations al WHERE al."employeeId" = e.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL)`);
    out.employeesMissingEquipment = finding(await q(`
      SELECT e."employeeCode" AS code, e."fullName" AS name, e.level, d.name AS team, e.process
      FROM employees e LEFT JOIN departments d ON d.id = e."departmentId"
      WHERE e."deletedAt" IS NULL AND e."employmentStatus" = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM asset_allocations al WHERE al."employeeId" = e.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL)
      ORDER BY e."fullName" LIMIT ${CAP}`), noKitCount[0]?.n ?? 0);

    out.employeesWithMultipleDevices = finding(await q(`
      SELECT e."employeeCode" AS code, e."fullName" AS name, e.level, d.name AS team,
             string_agg(coalesce(nullif(trim(coalesce(a.make,'') || ' ' || coalesce(a.model,'')), ''), c.name) || ' (' || a."assetTag" || ')', ', ' ORDER BY a."assetTag") AS devices,
             count(*)::int AS "deviceCount"
      FROM employees e LEFT JOIN departments d ON d.id = e."departmentId"
      JOIN asset_allocations al ON al."employeeId" = e.id AND al.status = 'ACTIVE' AND al."deletedAt" IS NULL
      JOIN assets a ON a.id = al."assetId" AND a."deletedAt" IS NULL
      JOIN asset_categories c ON c.id = a."categoryId"
      WHERE e."deletedAt" IS NULL AND c.name IN ('Laptop', 'Desktop')
      GROUP BY e.id, d.name HAVING count(*) > 1 ORDER BY count(*) DESC, e."fullName" LIMIT ${CAP}`));

    const modelCount = await q<{ n: number }>(`
      SELECT count(*)::int AS n FROM assets a JOIN asset_categories c ON c.id = a."categoryId"
      WHERE a."deletedAt" IS NULL AND (a.model IS NULL OR a.model = '') AND c.name IN ('Laptop','Desktop','Monitor','Headphone','Printer')`);
    out.missingModelNumbers = finding(await q(`
      SELECT a."assetTag" AS "assetId", c.name AS category, a."serialNumber" AS serial, a.status
      FROM assets a JOIN asset_categories c ON c.id = a."categoryId"
      WHERE a."deletedAt" IS NULL AND (a.model IS NULL OR a.model = '') AND c.name IN ('Laptop','Desktop','Monitor','Headphone','Printer')
      ORDER BY c.name, a."assetTag" LIMIT ${CAP}`), modelCount[0]?.n ?? 0);

    const serialCount = await q<{ n: number }>(`
      SELECT count(*)::int AS n FROM assets a JOIN asset_categories c ON c.id = a."categoryId"
      WHERE a."deletedAt" IS NULL AND (a."serialNumber" IS NULL OR a."serialNumber" = '') AND c.name IN ('Laptop','Desktop','Monitor','Printer')`);
    out.missingSerialNumbers = finding(await q(`
      SELECT a."assetTag" AS "assetId", c.name AS category, a.make, a.model, a.status
      FROM assets a JOIN asset_categories c ON c.id = a."categoryId"
      WHERE a."deletedAt" IS NULL AND (a."serialNumber" IS NULL OR a."serialNumber" = '') AND c.name IN ('Laptop','Desktop','Monitor','Printer')
      ORDER BY c.name, a."assetTag" LIMIT ${CAP}`), serialCount[0]?.n ?? 0);

    out.missingAssetIds = finding(await q(`
      SELECT a.id, c.name AS category FROM assets a JOIN asset_categories c ON c.id = a."categoryId"
      WHERE a."deletedAt" IS NULL AND (a."assetTag" IS NULL OR a."assetTag" = '') LIMIT ${CAP}`));

    out.orphanRecords = finding(await q(`
      SELECT a."assetTag" AS "assetId", c.name AS category, e."fullName" AS "heldBy", 'holder is archived' AS problem
      FROM asset_allocations al JOIN assets a ON a.id = al."assetId" JOIN asset_categories c ON c.id = a."categoryId"
      JOIN employees e ON e.id = al."employeeId"
      WHERE al.status = 'ACTIVE' AND al."deletedAt" IS NULL AND e."deletedAt" IS NOT NULL
      UNION ALL
      SELECT a."assetTag", c.name, coalesce(e."fullName", al."holderLabel"), 'asset is archived but still allocated'
      FROM asset_allocations al JOIN assets a ON a.id = al."assetId" JOIN asset_categories c ON c.id = a."categoryId"
      LEFT JOIN employees e ON e.id = al."employeeId"
      WHERE al.status = 'ACTIVE' AND al."deletedAt" IS NULL AND a."deletedAt" IS NOT NULL
      LIMIT ${CAP}`));

    out.missingSeatAssignments = finding(await q(`
      SELECT w."seatCode" AS seat, e."fullName" AS "assignedTo", 'seat owner is archived' AS problem
      FROM workstation_allocations wa JOIN workstations w ON w.id = wa."workstationId" JOIN employees e ON e.id = wa."employeeId"
      WHERE wa.status = 'ACTIVE' AND e."deletedAt" IS NOT NULL
      UNION ALL
      SELECT w."seatCode", NULL, 'seat had an owner and now has none'
      FROM workstations w WHERE w."deletedAt" IS NULL
        AND EXISTS (SELECT 1 FROM workstation_allocations wa WHERE wa."workstationId" = w.id)
        AND NOT EXISTS (SELECT 1 FROM workstation_allocations wa WHERE wa."workstationId" = w.id AND wa.status = 'ACTIVE')
      LIMIT ${CAP}`));

    out.missingEmployees = finding(await q(`
      SELECT al."holderLabel" AS name, count(*)::int AS assets
      FROM asset_allocations al WHERE al.status = 'ACTIVE' AND al."deletedAt" IS NULL AND al."holderType" = 'EMPLOYEE' AND al."employeeId" IS NULL
      GROUP BY al."holderLabel" ORDER BY assets DESC LIMIT ${CAP}`));

    return out;
  }
}
