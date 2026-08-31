import {
  BadRequestException, Body, Controller, Get, Inject, Module, NotFoundException,
  Param, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AllocationHolderType, AllocationStatus, AssetCondition, AssetEventType,
  AssetStatus, AuditAction, Prisma, WorkstationStatus,
} from '@prisma/client';
import { CurrentUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '@inventory/shared';
import { RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';

/**
 * Workstations: the seats on the floor and the kit at each one.
 *
 * Station equipment is allocated to the seat rather than to a person, so the
 * list joins through allocations on holderRefId rather than through employees.
 */
@ApiTags('workspaces')
@Controller('workstations')
class WorkstationsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every seat with its live equipment, for the building view. Seat codes
   * only - the floor plan deliberately carries no employee names.
   */
  @RequirePermissions('workspace.read')
  @Get('floor')
  async floor() {
    const stations = await this.prisma.workstation.findMany({
      where: { deletedAt: undefined },
      select: {
        id: true, seatCode: true, notes: true,
        location: { select: { name: true } },
      },
      orderBy: { seatCode: 'asc' },
    });

    const kit = await this.prisma.assetAllocation.findMany({
      where: { holderType: AllocationHolderType.WORKSTATION, status: AllocationStatus.ACTIVE },
      select: {
        holderRefId: true,
        asset: {
          select: {
            id: true, assetTag: true, model: true, serialNumber: true,
            category: { select: { name: true } },
          },
        },
      },
    });
    const byStation = new Map<string, Array<(typeof kit)[number]['asset']>>();
    for (const k of kit) {
      if (!k.holderRefId) continue;
      const list = byStation.get(k.holderRefId) ?? [];
      list.push(k.asset);
      byStation.set(k.holderRefId, list);
    }

    return stations.map((w) => ({
      id: w.id,
      seatCode: w.seatCode,
      wing: w.location?.name ?? 'Unassigned',
      process: w.notes?.match(/Process:\s*([^|]+)/)?.[1]?.trim() ?? null,
      missing: w.notes?.match(/Missing:\s*([^|]+)/)?.[1]?.trim().split(/,\s*/) ?? [],
      equipment: (byStation.get(w.id) ?? []).sort((a, b) =>
        a.category.name.localeCompare(b.category.name)),
    }));
  }

  @RequirePermissions('workspace.read')
  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('search') search?: string,
    @Query('locationId') locationId?: string,
    @Query('gapsOnly') gapsOnly?: string,
  ) {
    const take = Math.min(Number(pageSize) || 50, 200);
    const where: Prisma.WorkstationWhereInput = {
      ...(locationId ? { locationId } : {}),
      // "Missing:" is written by the importer when a station lacks kit.
      ...(gapsOnly === 'true' ? { notes: { contains: 'Missing:' } } : {}),
      ...(search
        ? {
            OR: [
              { seatCode: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total, locations] = await Promise.all([
      this.prisma.workstation.findMany({
        where,
        include: {
          location: { select: { id: true, name: true } },
          allocations: {
            where: { status: AllocationStatus.ACTIVE },
            include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
          },
        },
        orderBy: { seatCode: 'asc' },
        take,
        skip: ((Number(page) || 1) - 1) * take,
      }),
      this.prisma.workstation.count({ where }),
      this.prisma.location.findMany({
        where: { kind: 'WING' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // The kit at each seat is held by the seat, so fetch it by holderRefId.
    const ids = items.map((w) => w.id);
    const kit = ids.length
      ? await this.prisma.assetAllocation.findMany({
          where: {
            holderType: 'WORKSTATION',
            holderRefId: { in: ids },
            status: AllocationStatus.ACTIVE,
          },
          include: {
            asset: { select: { id: true, assetTag: true, category: { select: { name: true } } } },
          },
        })
      : [];

    const byStation = new Map<string, string[]>();
    for (const k of kit) {
      const list = byStation.get(k.holderRefId as string) ?? [];
      list.push(k.asset.category.name);
      byStation.set(k.holderRefId as string, list);
    }

    return {
      items: items.map((w) => ({
        ...w,
        equipment: (byStation.get(w.id) ?? []).sort(),
        missing:
          w.notes?.match(/Missing:\s*([^|]+)/)?.[1]?.trim().split(/,\s*/) ?? [],
        process: w.notes?.match(/Process:\s*([^|]+)/)?.[1]?.trim() ?? null,
        chair: w.notes?.match(/Chair:\s*([^|]+)/)?.[1]?.trim() ?? null,
      })),
      locations,
      page: Number(page) || 1,
      pageSize: take,
      total,
      totalPages: Math.ceil(total / take),
    };
  }

  @RequirePermissions('workspace.read')
  @Get(':id/equipment')
  async equipment(@Param('id') id: string) {
    return this.prisma.assetAllocation.findMany({
      where: { holderType: 'WORKSTATION', holderRefId: id },
      include: {
        asset: {
          select: {
            id: true, assetTag: true, model: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { allocatedAt: 'desc' },
    });
  }

  /** Admin adds an item at a seat: the asset is created and issued to it. */
  @RequirePermissions('workspace.manage')
  @Post(':id/equipment')
  async addEquipment(
    @Param('id') id: string,
    @Body() body: { categoryId: string; model?: string; serialNumber?: string },
    @CurrentUser() actor: Principal,
  ) {
    const station = await this.prisma.workstation.findFirst({ where: { id } });
    if (!station) throw new NotFoundException('Seat not found');
    const category = await this.prisma.assetCategory.findFirst({
      where: { id: body.categoryId },
    });
    if (!category) throw new BadRequestException('Choose what kind of item this is.');

    const serial = body.serialNumber?.trim() || null;
    if (serial) {
      const dupe = await this.prisma.asset.findFirst({ where: { serialNumber: serial } });
      if (dupe) {
        throw new BadRequestException(
          `Serial ${serial} already belongs to ${dupe.assetTag}.`,
        );
      }
    }

    // Sequential tag under the category prefix, same scheme as the importers.
    const prefix = (category.tagPrefix ?? category.code.slice(0, 4)).toUpperCase();
    let n = 1000 + (await this.prisma.asset.count({
      where: { assetTag: { startsWith: `${prefix}-` }, deletedAt: undefined },
    }));
    let assetTag = '';
    for (;;) {
      n += 1;
      assetTag = `${prefix}-${n}`;
      const clash = await this.prisma.asset.findFirst({
        where: { assetTag, deletedAt: undefined },
      });
      if (!clash) break;
    }

    const asset = await this.prisma.$transaction(async (tx) => {
      const a = await tx.asset.create({
        data: {
          assetTag,
          serialNumber: serial,
          categoryId: category.id,
          model: body.model?.trim() || null,
          status: AssetStatus.ALLOCATED,
          condition: AssetCondition.GOOD,
          branchId: station.branchId,
          locationId: station.locationId,
          notes: `${category.name} at station ${station.seatCode}`,
          createdById: actor.userId,
        },
      });
      const allocation = await tx.assetAllocation.create({
        data: {
          assetId: a.id,
          holderType: AllocationHolderType.WORKSTATION,
          holderRefId: station.id,
          holderLabel: `Station ${station.seatCode}`,
          status: AllocationStatus.ACTIVE,
          allocatedAt: new Date(),
          conditionOut: AssetCondition.GOOD,
          createdById: actor.userId,
        },
      });
      await tx.asset.update({ where: { id: a.id }, data: { currentAllocationId: allocation.id } });
      await tx.assetEvent.create({
        data: {
          assetId: a.id,
          eventType: AssetEventType.ALLOCATED,
          summary: `Added at station ${station.seatCode} by ${actor.displayName}`,
          refType: 'Workstation',
          refId: station.id,
          actorUserId: actor.userId,
          actorName: actor.displayName,
        },
      });
      return a;
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Asset',
      entityId: asset.id,
      entityLabel: asset.assetTag,
      summary: `${actor.displayName} added a ${category.name} at station ${station.seatCode}`,
    });
    return { id: asset.id, assetTag: asset.assetTag, category: category.name };
  }

  /**
   * Admin removes an item from a seat. The allocation is voided and the
   * asset archived - recoverable from Inventory's "show archived", never
   * destroyed.
   */
  @RequirePermissions('workspace.manage')
  @Post(':id/equipment/:assetId/remove')
  async removeEquipment(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @CurrentUser() actor: Principal,
  ) {
    const station = await this.prisma.workstation.findFirst({ where: { id } });
    if (!station) throw new NotFoundException('Seat not found');
    const allocation = await this.prisma.assetAllocation.findFirst({
      where: {
        assetId,
        holderType: AllocationHolderType.WORKSTATION,
        holderRefId: id,
        status: AllocationStatus.ACTIVE,
      },
      include: { asset: { include: { category: { select: { name: true } } } } },
    });
    if (!allocation) {
      throw new NotFoundException('That item is not at this seat any more.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.assetAllocation.update({
        where: { id: allocation.id },
        data: {
          deletedAt: new Date(),
          deletedById: actor.userId,
          voidReason: `Removed from station ${station.seatCode} by ${actor.displayName}`,
        },
      });
      await tx.asset.update({
        where: { id: assetId },
        data: {
          status: AssetStatus.RETIRED,
          deletedAt: new Date(),
          deletedById: actor.userId,
          archivedAt: new Date(),
          archiveReason: `Removed from station ${station.seatCode}`,
          currentAllocationId: null,
        },
      });
      await tx.assetEvent.create({
        data: {
          assetId,
          eventType: AssetEventType.ARCHIVED,
          summary: `Removed from station ${station.seatCode} by ${actor.displayName}`,
          refType: 'Workstation',
          refId: station.id,
          actorUserId: actor.userId,
          actorName: actor.displayName,
        },
      });
    });

    await this.audit.record({
      action: AuditAction.SOFT_DELETE,
      entityType: 'Asset',
      entityId: assetId,
      entityLabel: allocation.asset.assetTag,
      summary:
        `${actor.displayName} removed ${allocation.asset.category.name} ` +
        `${allocation.asset.assetTag} from station ${station.seatCode} (archived, recoverable)`,
    });
    return { removed: true };
  }
}

@Module({ controllers: [WorkstationsController] })
export class WorkspacesModule {}
