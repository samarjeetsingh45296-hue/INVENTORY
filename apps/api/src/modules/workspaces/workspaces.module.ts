import { Controller, Get, Inject, Module, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllocationStatus, Prisma, WorkstationStatus } from '@prisma/client';
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
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrisma) {}

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
}

@Module({ controllers: [WorkstationsController] })
export class WorkspacesModule {}
