import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Module, NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AssetCondition, AssetEventType, AssetStatus, AuditAction, Prisma, RepairStatus,
} from '@prisma/client';
import { categoryFor } from '../reconcile/importers/ccc';

/** A repair as the sheet's Repair tab writes it: one row, these columns. */
interface RepairEntry {
  bdeName?: string;
  imei1?: string;
  imei2?: string;
  phoneModel?: string;
  department?: string;
  damage?: string;
  givenDate?: string | null;
  receivedDate?: string | null;
  returnDate?: string | null;
  note?: string;
  deduction?: boolean;
  price?: number | null;
  /** Repaired or not: the only two states the page shows. */
  repaired?: boolean;
}

const S = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const digits = (v: unknown) => S(v).replace(/\D/g, '');
const dateOrNull = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '@inventory/shared';

/** Statuses that mean the ticket is finished. */
const CLOSED = [RepairStatus.RETURNED_TO_STOCK, RepairStatus.CANCELLED, RepairStatus.UNREPAIRABLE];
/** Statuses the page shows as "Repaired". */
const REPAIRED_STATES = [RepairStatus.REPAIRED, RepairStatus.RETURNED_TO_STOCK];

@ApiTags('repairs')
@Controller('repairs')
export class RepairsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('repair.read')
  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('search') search?: string,
    @Query('status') status?: RepairStatus,
    @Query('openOnly') openOnly?: string,
    @Query('repaired') repaired?: string,
  ) {
    const take = Math.min(Number(pageSize) || 50, 200);
    const where: Prisma.RepairTicketWhereInput = {
      ...(status ? { status } : {}),
      ...(openOnly === 'true' ? { status: { notIn: CLOSED } } : {}),
      // The page's Status filter: repaired or not, the only two states it shows.
      ...(repaired === 'yes' ? { status: { in: REPAIRED_STATES } } : {}),
      ...(repaired === 'no' ? { status: { notIn: REPAIRED_STATES } } : {}),
      ...(search
        ? {
            OR: [
              { ticketNo: { contains: search, mode: 'insensitive' } },
              { reporterName: { contains: search, mode: 'insensitive' } },
              { department: { contains: search, mode: 'insensitive' } },
              { faultDescription: { contains: search, mode: 'insensitive' } },
              { resolution: { contains: search, mode: 'insensitive' } },
              { asset: { assetTag: { contains: search, mode: 'insensitive' } } },
              { asset: { serialNumber: { contains: search, mode: 'insensitive' } } },
              { asset: { model: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.repairTicket.findMany({
        where,
        include: {
          asset: {
            select: {
              id: true, assetTag: true, model: true, serialNumber: true, specs: true,
              category: { select: { name: true } },
            },
          },
          vendor: { select: { name: true } },
          reportedBy: { select: { id: true, fullName: true, employeeCode: true, level: true } },
        },
        orderBy: { reportedAt: 'desc' },
        take,
        skip: ((Number(page) || 1) - 1) * take,
      }),
      this.prisma.repairTicket.count({ where }),
    ]);

    return {
      // Decimal does not survive JSON serialisation.
      items: items.map((t) => ({
        ...t,
        // The phone's second IMEI, as the Repair tab records it.
        imei2: ((t.asset?.specs as Record<string, unknown> | null)?.imei2 as string | undefined) ?? null,
        estimatedCost: t.estimatedCost ? Number(t.estimatedCost) : null,
        actualCost: t.actualCost ? Number(t.actualCost) : null,
        recoveryAmount: t.recoveryAmount ? Number(t.recoveryAmount) : null,
      })),
      page: Number(page) || 1,
      pageSize: take,
      total,
      totalPages: Math.ceil(total / take),
    };
  }

  /** Raise a ticket and move the asset into repair, in one transaction. */
  @RequirePermissions('repair.create')
  @Post()
  async create(
    @Body() body: { assetId: string; faultDescription: string; faultCategory?: string; priority?: string },
    @CurrentUser() user: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirstOrThrow({ where: { id: body.assetId } });
      const count = await tx.repairTicket.count();
      const ticket = await tx.repairTicket.create({
        data: {
          ticketNo: `RPR-${String(count + 1).padStart(5, '0')}`,
          assetId: body.assetId,
          faultDescription: body.faultDescription,
          faultCategory: body.faultCategory ?? null,
          priority: body.priority ?? 'NORMAL',
          status: RepairStatus.REPORTED,
          reportedAt: new Date(),
          createdById: user.userId,
        },
      });
      await tx.asset.update({
        where: { id: body.assetId },
        data: { status: AssetStatus.IN_REPAIR, updatedById: user.userId },
      });
      await tx.assetEvent.create({
        data: {
          assetId: body.assetId,
          eventType: AssetEventType.SENT_FOR_REPAIR,
          summary: `Repair ${ticket.ticketNo} raised: ${body.faultDescription}`,
          refType: 'RepairTicket',
          refId: ticket.id,
          actorUserId: user.userId,
          actorName: user.displayName,
        },
      });
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: 'RepairTicket',
        entityId: ticket.id,
        entityLabel: ticket.ticketNo,
        summary: `Repair raised for ${asset.assetTag}`,
      });
      return ticket;
    });
  }

  /**
   * The phone a repair entry is about: the one with that IMEI, else a new
   * CUG phone record with it, so an entry never fails for want of a record.
   */
  private async phoneFor(entry: RepairEntry, userId: string) {
    const imei = digits(entry.imei1);
    const imei2 = digits(entry.imei2) || null;
    const model = S(entry.phoneModel) || null;
    let asset = imei ? await this.prisma.asset.findFirst({ where: { serialNumber: imei } }) : null;
    if (!asset) {
      const { code, name } = categoryFor('CUG Phone');
      const category =
        (await this.prisma.assetCategory.findFirst({ where: { code } })) ??
        (await this.prisma.assetCategory.create({ data: { code, name, tagPrefix: code.slice(0, 4) } }));
      const prefix = (category.tagPrefix ?? category.code.slice(0, 4)).toUpperCase();
      let n = 1000 + (await this.prisma.asset.count({ where: { assetTag: { startsWith: `${prefix}-` } } }));
      let assetTag = '';
      for (;;) {
        n += 1;
        assetTag = `${prefix}-${n}`;
        if (!(await this.prisma.asset.findFirst({ where: { assetTag } }))) break;
      }
      asset = await this.prisma.asset.create({
        data: {
          assetTag, serialNumber: imei || null, categoryId: category.id, model,
          specs: imei2 ? { imei2 } : {},
          status: AssetStatus.IN_REPAIR, condition: AssetCondition.GOOD,
          notes: 'Created from a repair entry', createdById: userId,
        },
      });
    } else {
      const specs = (asset.specs as Record<string, unknown> | null) ?? {};
      const data: Record<string, unknown> = {};
      if (imei2 && specs.imei2 !== imei2) data.specs = { ...specs, imei2 };
      if (model && asset.model !== model) data.model = model;
      if (Object.keys(data).length) asset = await this.prisma.asset.update({ where: { id: asset.id }, data });
    }
    return asset;
  }

  /** What an entry writes on a ticket. */
  private entryData(entry: RepairEntry, reportedById: string | null) {
    const given = dateOrNull(entry.givenDate);
    const received = dateOrNull(entry.receivedDate);
    const returned = dateOrNull(entry.returnDate);
    const repaired = entry.repaired ?? false;
    return {
      reporterName: S(entry.bdeName) || null,
      reportedById,
      department: S(entry.department) || null,
      faultDescription: S(entry.damage) || 'Not recorded',
      status: repaired ? RepairStatus.REPAIRED : RepairStatus.IN_PROGRESS,
      reportedAt: given ?? new Date(),
      sentToVendorAt: given,
      receivedBackAt: received,
      closedAt: returned ?? (repaired ? received : null),
      resolution: S(entry.note) || null,
      chargedToEmployee: Boolean(entry.deduction),
      actualCost: entry.price === null || entry.price === undefined || entry.price === ('' as unknown) ? null : Number(entry.price),
    };
  }

  private async reporterFor(name: string | undefined): Promise<string | null> {
    const n = S(name);
    if (!n) return null;
    const emp = await this.prisma.employee.findFirst({
      where: { fullName: { equals: n, mode: 'insensitive' }, deletedAt: undefined },
      select: { id: true },
    });
    return emp?.id ?? null;
  }

  /** Add a repair as a row of the sheet: name, IMEIs, model, damage, dates, note, deduction, price. */
  @RequirePermissions('repair.create')
  @Post('entry')
  async createEntry(@Body() entry: RepairEntry, @CurrentUser() user: Principal) {
    if (!digits(entry.imei1) && !S(entry.damage)) {
      throw new BadRequestException('Give at least the IMEI or what was damaged.');
    }
    const asset = await this.phoneFor(entry, user.userId);
    const data = this.entryData(entry, await this.reporterFor(entry.bdeName));
    const stamp = data.reportedAt.toISOString().slice(0, 10).replace(/-/g, '');
    let ticketNo = `RPR-${(digits(entry.imei1) || 'NOIMEI').slice(-8)}-${stamp}`;
    for (let i = 2; await this.prisma.repairTicket.findFirst({ where: { ticketNo } }); i++) {
      ticketNo = `RPR-${(digits(entry.imei1) || 'NOIMEI').slice(-8)}-${stamp}-${i}`;
    }
    const ticket = await this.prisma.repairTicket.create({
      data: { ticketNo, assetId: asset.id, ...data, createdById: user.userId },
    });
    if (!data.status.startsWith('REPAIRED')) {
      await this.prisma.asset.update({ where: { id: asset.id }, data: { status: AssetStatus.IN_REPAIR } });
    }
    await this.audit.record({
      action: AuditAction.CREATE, entityType: 'RepairTicket', entityId: ticket.id, entityLabel: ticket.ticketNo,
      summary: `Repair entry added: ${data.reporterName ?? 'no name'}, ${asset.model ?? 'phone'} ${asset.serialNumber ?? ''} - ${data.faultDescription}`,
    });
    return ticket;
  }

  /** Change any column of a repair entry. */
  @RequirePermissions('repair.update')
  @Patch(':id/entry')
  async updateEntry(@Param('id') id: string, @Body() entry: RepairEntry, @CurrentUser() user: Principal) {
    const before = await this.prisma.repairTicket.findFirst({ where: { id }, include: { asset: true } });
    if (!before) throw new NotFoundException('That repair entry no longer exists.');
    // A changed IMEI points the entry at that phone (creating it if new).
    const imei = digits(entry.imei1);
    const asset = imei && imei !== before.asset.serialNumber
      ? await this.phoneFor(entry, user.userId)
      : await this.phoneFor({ ...entry, imei1: before.asset.serialNumber ?? '' }, user.userId);
    const data = this.entryData(entry, await this.reporterFor(entry.bdeName));
    const after = await this.prisma.repairTicket.update({
      where: { id },
      data: { ...data, assetId: asset.id, updatedById: user.userId },
    });
    if (before.status !== after.status) {
      await this.prisma.repairLog.create({
        data: { ticketId: id, fromStatus: before.status, toStatus: after.status, actorUserId: user.userId, actorName: user.displayName },
      });
    }
    await this.audit.record({
      action: AuditAction.UPDATE, entityType: 'RepairTicket', entityId: id, entityLabel: after.ticketNo,
      oldValue: { reporterName: before.reporterName, department: before.department, faultDescription: before.faultDescription, status: before.status, actualCost: before.actualCost ? Number(before.actualCost) : null, resolution: before.resolution },
      newValue: { reporterName: after.reporterName, department: after.department, faultDescription: after.faultDescription, status: after.status, actualCost: after.actualCost ? Number(after.actualCost) : null, resolution: after.resolution },
      summary: `Repair entry ${after.ticketNo} edited`,
    });
    return after;
  }

  /** Remove a repair entry. Archived, not destroyed: the change history keeps it. */
  @RequirePermissions('repair.update')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: Principal) {
    const t = await this.prisma.repairTicket.findFirst({ where: { id } });
    if (!t) throw new NotFoundException('That repair entry no longer exists.');
    await this.prisma.repairTicket.update({ where: { id }, data: { deletedAt: new Date(), deletedById: user.userId } });
    await this.audit.record({
      action: AuditAction.SOFT_DELETE, entityType: 'RepairTicket', entityId: id, entityLabel: t.ticketNo,
      summary: `Repair entry ${t.ticketNo} removed (${t.reporterName ?? 'no name'}: ${t.faultDescription})`,
    });
    return { removed: true };
  }

  /**
   * Progress a ticket. Reaching a closed status returns the asset to stock, so
   * an item cannot be quietly left marked "in repair" forever.
   */
  @RequirePermissions('repair.update')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { status?: RepairStatus; note?: string; actualCost?: number; resolution?: string },
    @CurrentUser() user: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.repairTicket.findFirstOrThrow({ where: { id } });
      const status = body.status ?? before.status;
      const isClosed = CLOSED.includes(status as never);
      const settled = isClosed || status === RepairStatus.REPAIRED;

      const after = await tx.repairTicket.update({
        where: { id },
        data: {
          status,
          actualCost: body.actualCost ?? before.actualCost,
          resolution: body.resolution ?? before.resolution,
          receivedBackAt: settled ? (before.receivedBackAt ?? new Date()) : before.receivedBackAt,
          closedAt: isClosed ? new Date() : null,
          closedById: isClosed ? user.userId : null,
          updatedById: user.userId,
        },
      });

      if (body.status && body.status !== before.status) {
        await tx.repairLog.create({
          data: {
            ticketId: id,
            fromStatus: before.status,
            toStatus: body.status,
            note: body.note ?? null,
            actorUserId: user.userId,
            actorName: user.displayName,
          },
        });
      }

      if (status === RepairStatus.RETURNED_TO_STOCK) {
        await tx.asset.update({
          where: { id: before.assetId },
          data: { status: AssetStatus.IN_STOCK, updatedById: user.userId },
        });
        await tx.assetEvent.create({
          data: {
            assetId: before.assetId,
            eventType: AssetEventType.REPAIR_COMPLETED,
            summary: `${after.ticketNo} closed; back in stock`,
            refType: 'RepairTicket',
            refId: id,
            actorUserId: user.userId,
            actorName: user.displayName,
          },
        });
      }

      await this.audit.record({
        action: AuditAction.UPDATE,
        entityType: 'RepairTicket',
        entityId: id,
        entityLabel: after.ticketNo,
        oldValue: { status: before.status },
        newValue: { status: after.status },
        summary: `${after.ticketNo}: ${before.status} to ${after.status}`,
      });
      return after;
    });
  }
}

@Module({ controllers: [RepairsController] })
export class RepairsModule {}
