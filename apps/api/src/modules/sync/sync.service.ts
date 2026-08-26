import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  SourceType,
  SyncMode,
  SyncSchedule,
} from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BackupService } from '../backup/backup.service';
import { GoogleSheetsAdapter } from './adapters/google-sheets.adapter';
import { SyncEngine } from './sync.engine';
import type { Principal } from '@inventory/shared';

/** Header text the importer recognises for common fields, lower-cased. */
const FIELD_HINTS: Record<string, string[]> = {
  employeeCode: ['employee code', 'emp code', 'empcode', 'emp id', 'employee id', 'staff id'],
  firstName: ['first name', 'employee name', 'name', 'staff name', 'full name'],
  lastName: ['last name', 'surname'],
  officialEmail: ['email', 'official email', 'company email', 'email id', 'work email'],
  personalEmail: ['personal email'],
  phone: ['mobile', 'phone', 'contact', 'mobile no', 'contact number'],
  dateOfJoining: ['doj', 'date of joining', 'joining date'],
  dateOfLeaving: ['dol', 'date of leaving', 'exit date', 'last working day'],
  process: ['process', 'campaign', 'project'],
  shift: ['shift'],
  seatNumber: ['seat', 'seat no', 'seat number', 'workstation'],
  serialNumber: ['serial', 'serial no', 'serial number', 'sr no', 'sl no', 'imei'],
  assetTag: ['asset tag', 'asset code', 'asset id', 'tag', 'asset no'],
  make: ['make', 'brand', 'manufacturer'],
  model: ['model', 'model no'],
  categoryCode: ['category', 'asset type', 'item type', 'type', 'item'],
  purchaseDate: ['purchase date', 'po date', 'bill date', 'invoice date'],
  purchaseCost: ['cost', 'price', 'amount', 'value'],
  warrantyEndsAt: ['warranty', 'warranty end', 'warranty expiry'],
  status: ['status'],
  condition: ['condition', 'physical condition'],
  notes: ['remark', 'remarks', 'note', 'notes', 'comment'],
};

/** Transform to apply for a given target field when auto-suggesting. */
const FIELD_TRANSFORM: Record<string, string> = {
  dateOfJoining: 'date',
  dateOfLeaving: 'date',
  dateOfBirth: 'date',
  purchaseDate: 'date',
  warrantyEndsAt: 'date',
  purchaseCost: 'number',
  phone: 'phone',
  officialEmail: 'email',
  personalEmail: 'email',
  employeeCode: 'upper',
  serialNumber: 'upper',
  assetTag: 'upper',
  categoryCode: 'upper',
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
    private readonly sheets: GoogleSheetsAdapter,
    private readonly backup: BackupService,
    private readonly engine: SyncEngine,
  ) {}

  async createSource(body: Record<string, unknown>) {
    const created = await this.prisma.syncSource.create({
      data: {
        name: String(body.name),
        sourceType: (body.sourceType as SourceType) ?? SourceType.GOOGLE_SHEET,
        spreadsheetId: (body.spreadsheetId as string) ?? null,
        sheetGid: body.sheetGid != null ? String(body.sheetGid) : null,
        sheetName: (body.sheetName as string) ?? null,
        workbookLabel: (body.workbookLabel as string) ?? null,
        targetEntity: String(body.targetEntity ?? 'employee'),
        headerRow: Number(body.headerRow ?? 1),
        dedupeKeys: (body.dedupeKeys as string[]) ?? [],
        mode: (body.mode as SyncMode) ?? SyncMode.MANUAL,
        schedule: (body.schedule as SyncSchedule) ?? SyncSchedule.OFF,
        allowUpdates: body.allowUpdates !== false,
      },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'SyncSource',
      entityId: created.id,
      entityLabel: created.name,
      summary: `Added sync source "${created.name}"`,
    });
    return created;
  }

  async updateSource(id: string, body: Record<string, unknown>) {
    const before = await this.prisma.syncSource.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Sync source not found');

    const updated = await this.prisma.syncSource.update({
      where: { id },
      data: body as never,
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'SyncSource',
      entityId: id,
      entityLabel: updated.name,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  /** Reads only the header row, so mapping can be set up before importing. */
  async previewColumns(id: string) {
    const source = await this.prisma.syncSource.findFirst({
      where: { id },
      include: { mappings: true },
    });
    if (!source) throw new NotFoundException('Sync source not found');

    const table = await this.sheets.read({
      spreadsheetId: source.spreadsheetId,
      sheetGid: source.sheetGid,
      sheetName: source.sheetName,
      headerRow: source.headerRow,
    });

    return {
      headers: table.headers,
      sampleRows: table.rows.slice(0, 5).map((r) => r.raw),
      totalRows: table.rows.length,
      existingMappings: source.mappings,
    };
  }

  /**
   * Best-effort automatic column mapping. It is a starting point the admin
   * reviews; nothing is applied until the mapping is saved explicitly.
   */
  async suggestMappings(id: string) {
    const { headers } = await this.previewColumns(id);
    const source = await this.prisma.syncSource.findFirstOrThrow({ where: { id } });

    const used = new Set<string>();
    const suggestions = headers.map((header) => {
      const norm = header.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

      let bestField: string | null = null;
      let bestScore = 0;
      for (const [field, hints] of Object.entries(FIELD_HINTS)) {
        if (used.has(field)) continue;
        for (const hint of hints) {
          const score = norm === hint ? 100 : norm.includes(hint) ? 60 + hint.length : 0;
          if (score > bestScore) {
            bestScore = score;
            bestField = field;
          }
        }
      }
      if (bestField && bestScore >= 60) used.add(bestField);

      return {
        sourceHeader: header,
        targetField: bestScore >= 60 ? bestField : null,
        transform: bestField ? (FIELD_TRANSFORM[bestField] ?? 'trim') : 'trim',
        confidence: bestScore >= 100 ? 'high' : bestScore >= 60 ? 'likely' : 'none',
        isIgnored: bestScore < 60,
      };
    });

    return { targetEntity: source.targetEntity, suggestions };
  }

  async replaceMappings(id: string, mappings: Array<Record<string, unknown>>) {
    await this.prisma.$transaction(async (tx) => {
      await tx.syncColumnMapping.deleteMany({ where: { sourceId: id } });
      await tx.syncColumnMapping.createMany({
        data: mappings
          .filter((m) => m.targetField)
          .map((m) => ({
            sourceId: id,
            sourceHeader: String(m.sourceHeader),
            targetField: String(m.targetField),
            transform: String(m.transform ?? 'trim'),
            transformArg: (m.transformArg as object) ?? {},
            isRequired: Boolean(m.isRequired),
            defaultValue: (m.defaultValue as string) ?? null,
            isIgnored: Boolean(m.isIgnored),
          })),
      });
    });

    await this.audit.record({
      action: AuditAction.SETTING_CHANGED,
      entityType: 'SyncSource',
      entityId: id,
      summary: `Column mapping updated (${mappings.length} columns)`,
    });

    return this.prisma.syncColumnMapping.findMany({ where: { sourceId: id } });
  }

  // ------------------------------------------------- migration / cut-off ----

  /**
   * Option 3: import once, then disconnect for good.
   *
   * A full backup is taken first, so the migration itself is reversible even
   * though nothing it does is destructive.
   */
  async oneTimeMigration(id: string, user: Principal) {
    const source = await this.prisma.syncSource.findFirst({ where: { id } });
    if (!source) throw new NotFoundException('Sync source not found');

    const backup = await this.backup.createBackup({
      type: 'PRE_MIGRATION',
      reason: `Before one-time migration of "${source.name}"`,
    });

    await this.prisma.syncSource.update({
      where: { id },
      data: { mode: SyncMode.ONE_TIME_MIGRATION, schedule: SyncSchedule.OFF },
    });

    // The engine disconnects the source itself once the run succeeds.
    const result = await this.engine.run({ sourceId: id, dryRun: false });

    await this.audit.record({
      action: AuditAction.IMPORT,
      entityType: 'SyncSource',
      entityId: id,
      entityLabel: source.name,
      summary:
        `One-time migration completed by ${user.displayName}. The sheet is now ` +
        'disconnected; all imported data lives permanently in the database.',
      refType: 'BackupRun',
      refId: backup.id,
    });

    return { ...result, preRunBackupId: backup.id };
  }

  /**
   * Stops syncing from a sheet. Deliberately does NOT touch a single imported
   * record: disconnecting is about the link, never about the data.
   */
  async disconnect(id: string, user: Principal) {
    const source = await this.prisma.syncSource.findFirst({ where: { id } });
    if (!source) throw new NotFoundException('Sync source not found');

    const [employees, assets] = await Promise.all([
      this.prisma.employee.count(),
      this.prisma.asset.count(),
    ]);

    const updated = await this.prisma.syncSource.update({
      where: { id },
      data: {
        isDisconnected: true,
        disconnectedAt: new Date(),
        disconnectedById: user.userId,
        schedule: SyncSchedule.OFF,
      },
    });

    await this.audit.record({
      action: AuditAction.SETTING_CHANGED,
      entityType: 'SyncSource',
      entityId: id,
      entityLabel: source.name,
      summary:
        `Disconnected from Google Sheets by ${user.displayName}. No records were ` +
        'removed.',
    });

    return {
      source: updated,
      retained: { employees, assets },
      message:
        'The sheet is disconnected. Every record already imported stays in the ' +
        'database and the site continues to work exactly as before, even if the ' +
        'spreadsheet is deleted.',
    };
  }

  async reconnect(id: string) {
    const updated = await this.prisma.syncSource.update({
      where: { id },
      data: { isDisconnected: false, disconnectedAt: null, disconnectedById: null },
    });
    await this.audit.record({
      action: AuditAction.SETTING_CHANGED,
      entityType: 'SyncSource',
      entityId: id,
      entityLabel: updated.name,
      summary: 'Sync source reconnected',
    });
    return updated;
  }

  /** Option 2: scheduled sync. */
  async setSchedule(id: string, schedule: SyncSchedule) {
    const updated = await this.prisma.syncSource.update({
      where: { id },
      data: {
        schedule,
        mode: schedule === SyncSchedule.OFF ? SyncMode.MANUAL : SyncMode.SCHEDULED,
      },
    });
    await this.audit.record({
      action: AuditAction.SETTING_CHANGED,
      entityType: 'SyncSource',
      entityId: id,
      entityLabel: updated.name,
      summary: `Sync schedule set to ${schedule}`,
    });
    return updated;
  }

  /** Creates (or reuses) a source row representing an uploaded file. */
  async ensureUploadSource(
    sourceId: string | undefined,
    targetEntity: string,
    fileName: string,
  ): Promise<string> {
    if (sourceId) return sourceId;

    const existing = await this.prisma.syncSource.findFirst({
      where: { sourceType: SourceType.EXCEL_UPLOAD, targetEntity },
    });
    if (existing) return existing.id;

    const created = await this.prisma.syncSource.create({
      data: {
        name: `Uploaded file (${targetEntity})`,
        sourceType: SourceType.EXCEL_UPLOAD,
        targetEntity,
        workbookLabel: fileName,
        mode: SyncMode.MANUAL,
        dedupeKeys: targetEntity === 'employee' ? ['employeeCode'] : ['serialNumber'],
      },
    });
    return created.id;
  }
}
