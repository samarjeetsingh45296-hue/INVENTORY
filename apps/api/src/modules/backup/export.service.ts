import { Inject, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AuditAction, BackupFormat, BackupStatus, BackupType } from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextStore } from '../../common/context/request-context';

/**
 * Human-readable backups: a multi-sheet Excel workbook, or CSV per dataset.
 *
 * These complement, and never replace, the pg_dump backup. A spreadsheet is
 * what somebody can open and read; the dump is what actually restores.
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  /** Every dataset the export contains, in sheet order. */
  private async collect(): Promise<Record<string, Array<Record<string, unknown>>>> {
    const [employees, assets, allocations, repairs, lockers, cug, workstations] =
      await Promise.all([
        this.prisma.employee.findMany({
          include: { branch: true, department: true, designation: true },
          orderBy: { employeeCode: 'asc' },
        }),
        this.prisma.asset.findMany({
          include: { category: true, branch: true, location: true },
          orderBy: { assetTag: 'asc' },
        }),
        this.prisma.assetAllocation.findMany({
          include: { asset: true, employee: true },
          orderBy: { allocatedAt: 'desc' },
        }),
        this.prisma.repairTicket.findMany({
          include: { asset: true, vendor: true },
          orderBy: { reportedAt: 'desc' },
        }),
        this.prisma.locker.findMany({ include: { branch: true } }),
        this.prisma.cugConnection.findMany({ include: { branch: true } }),
        this.prisma.workstation.findMany({ include: { branch: true } }),
      ]);

    return {
      Employees: employees.map((e) => ({
        'Employee Code': e.employeeCode,
        Name: e.fullName,
        Email: e.officialEmail,
        Phone: e.phone,
        Branch: e.branch?.name ?? '',
        Department: e.department?.name ?? '',
        Designation: e.designation?.name ?? '',
        Status: e.employmentStatus,
        'Date of Joining': e.dateOfJoining,
        'Date of Leaving': e.dateOfLeaving,
        Process: e.process,
        Shift: e.shift,
      })),
      Assets: assets.map((a) => ({
        'Asset Tag': a.assetTag,
        Serial: a.serialNumber,
        Category: a.category.name,
        Make: a.make,
        Model: a.model,
        Status: a.status,
        Condition: a.condition,
        Branch: a.branch?.name ?? '',
        Location: a.location?.name ?? '',
        'Purchase Date': a.purchaseDate,
        'Purchase Cost': a.purchaseCost ? Number(a.purchaseCost) : null,
        'Warranty Ends': a.warrantyEndsAt,
      })),
      Allocations: allocations.map((al) => ({
        'Asset Tag': al.asset.assetTag,
        'Employee Code': al.employee?.employeeCode ?? al.holderLabel ?? '',
        'Employee Name': al.employee?.fullName ?? '',
        Status: al.status,
        'Allocated On': al.allocatedAt,
        'Returned On': al.returnedAt,
        'Condition Out': al.conditionOut,
        'Condition In': al.conditionIn,
        Remarks: al.remarks,
      })),
      Repairs: repairs.map((r) => ({
        Ticket: r.ticketNo,
        'Asset Tag': r.asset.assetTag,
        Status: r.status,
        Fault: r.faultDescription,
        Vendor: r.vendor?.name ?? '',
        'Reported At': r.reportedAt,
        'Back On': r.receivedBackAt,
        Cost: r.actualCost ? Number(r.actualCost) : null,
      })),
      Lockers: lockers.map((l) => ({
        'Locker No': l.lockerNo,
        Branch: l.branch.name,
        Status: l.status,
        'Lock Type': l.lockType,
        'Key Number': l.keyNumber,
      })),
      CUG: cug.map((c) => ({
        'Mobile Number': c.mobileNumber,
        Operator: c.operator,
        Plan: c.planName,
        Status: c.status,
        Branch: c.branch.name,
        'Activated On': c.activatedOn,
      })),
      Workstations: workstations.map((w) => ({
        Seat: w.seatCode,
        Branch: w.branch.name,
        Status: w.status,
        'Hot Desk': w.isHotDesk,
      })),
    };
  }

  /** One .xlsx with a sheet per dataset. */
  async exportWorkbook(): Promise<{ filePath: string; fileName: string; sizeBytes: number }> {
    const data = await this.collect();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Inventory Suite';
    wb.created = new Date();

    for (const [sheetName, rows] of Object.entries(data)) {
      const ws = wb.addWorksheet(sheetName);
      if (rows.length === 0) {
        ws.addRow(['No records']);
        continue;
      }
      const headers = Object.keys(rows[0] as Record<string, unknown>);
      ws.addRow(headers);
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      for (const row of rows) ws.addRow(headers.map((h) => row[h] ?? ''));
      ws.columns.forEach((c) => (c.width = 20));
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
    }

    const dir = resolve(process.env.BACKUP_DIR ?? './backups', 'exports');
    await mkdir(dir, { recursive: true });
    const fileName = `inventory-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const filePath = join(dir, fileName);
    await wb.xlsx.writeFile(filePath);

    const { size } = await stat(filePath);
    await this.recordExport(BackupFormat.EXCEL, fileName, filePath, size);
    return { filePath, fileName, sizeBytes: size };
  }

  /** RFC 4180 CSV for a single dataset. */
  async exportCsv(dataset: string): Promise<{ fileName: string; content: string }> {
    const data = await this.collect();
    const rows = data[dataset];
    if (!rows) {
      throw new Error(
        `Unknown dataset "${dataset}". Available: ${Object.keys(data).join(', ')}`,
      );
    }

    const headers = rows.length ? Object.keys(rows[0] as Record<string, unknown>) : [];
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const content = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
    ].join('\r\n');

    const fileName = `${dataset.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    await this.recordExport(BackupFormat.CSV, fileName, null, Buffer.byteLength(content));
    return { fileName, content };
  }

  listDatasets(): string[] {
    return ['Employees', 'Assets', 'Allocations', 'Repairs', 'Lockers', 'CUG', 'Workstations'];
  }

  private async recordExport(
    format: BackupFormat,
    fileName: string,
    filePath: string | null,
    sizeBytes: number,
  ): Promise<void> {
    const ctx = RequestContextStore.get();
    await this.prisma.backupRun.create({
      data: {
        type: BackupType.MANUAL,
        format,
        status: BackupStatus.SUCCESS,
        fileName,
        filePath,
        sizeBytes: BigInt(sizeBytes),
        finishedAt: new Date(),
        triggeredById: ctx.userId,
        triggeredByName: ctx.userName,
      },
    });
    // Exporting data is itself sensitive, so it is always recorded.
    await this.audit.record({
      action: AuditAction.EXPORT,
      entityType: 'BackupRun',
      entityLabel: fileName,
      summary: `${format} export generated by ${ctx.userName}`,
    });
  }
}
