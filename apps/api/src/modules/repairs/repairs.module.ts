import { Body, Controller, Get, Inject, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AssetEventType, AssetStatus, AuditAction, Prisma, RepairStatus,
} from '@prisma/client';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '@inventory/shared';

/** Statuses that mean the ticket is finished. */
const CLOSED = [RepairStatus.RETURNED_TO_STOCK, RepairStatus.CANCELLED, RepairStatus.UNREPAIRABLE];

@ApiTags('repairs')
@Controller('repairs')
class RepairsController {
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
  ) {
    const take = Math.min(Number(pageSize) || 50, 200);
    const where: Prisma.RepairTicketWhereInput = {
      ...(status ? { status } : {}),
      ...(openOnly === 'true' ? { status: { notIn: CLOSED } } : {}),
      ...(search
        ? {
            OR: [
              { ticketNo: { contains: search, mode: 'insensitive' } },
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
              id: true, assetTag: true, model: true, serialNumber: true,
              category: { select: { name: true } },
            },
          },
          vendor: { select: { name: true } },
          reportedBy: { select: { fullName: true, employeeCode: true } },
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
