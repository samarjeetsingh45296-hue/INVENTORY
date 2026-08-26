import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AssetStatus } from '@prisma/client';
import { CurrentUser, RequireAny, RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import type { Principal } from '@inventory/shared';

@ApiTags('dashboard')
@Controller('dashboard')
class DashboardController {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrisma) {}

  /**
   * Headline numbers. Everything here counts live database rows: the figures
   * stay correct whether or not any Google Sheet still exists.
   */
  @RequirePermissions('dashboard.read', 'asset.read_own')
  @RequireAny()
  @Get('summary')
  async summary(@CurrentUser() principal: Principal) {
    const branchFilter = principal.branchScope.length
      ? { branchId: { in: principal.branchScope } }
      : {};

    const [
      totalAssets, allocated, inStock, inRepair,
      employees, openRepairs, pendingApprovals, lastSync, lastBackup,
    ] = await Promise.all([
      this.prisma.asset.count({ where: branchFilter }),
      this.prisma.asset.count({ where: { ...branchFilter, status: AssetStatus.ALLOCATED } }),
      this.prisma.asset.count({ where: { ...branchFilter, status: AssetStatus.IN_STOCK } }),
      this.prisma.asset.count({ where: { ...branchFilter, status: AssetStatus.IN_REPAIR } }),
      this.prisma.employee.count({ where: { ...branchFilter, employmentStatus: 'ACTIVE' } }),
      this.prisma.repairTicket.count({
        where: { status: { notIn: ['RETURNED_TO_STOCK', 'CANCELLED', 'UNREPAIRABLE'] } },
      }),
      this.prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.syncRun.findFirst({
        orderBy: { startedAt: 'desc' },
        include: { source: { select: { name: true } } },
      }),
      this.prisma.backupRun.findFirst({
        where: { status: 'SUCCESS' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    const byCategory = await this.prisma.asset.groupBy({
      by: ['categoryId'],
      where: branchFilter,
      _count: { _all: true },
    });
    const categories = await this.prisma.assetCategory.findMany({
      where: { id: { in: byCategory.map((c) => c.categoryId) } },
      select: { id: true, name: true },
    });

    return {
      assets: { total: totalAssets, allocated, inStock, inRepair },
      employees,
      openRepairs,
      pendingApprovals,
      byCategory: byCategory
        .map((c) => ({
          category: categories.find((x) => x.id === c.categoryId)?.name ?? 'Uncategorised',
          count: c._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      lastSync: lastSync
        ? {
            at: lastSync.startedAt,
            source: lastSync.source.name,
            status: lastSync.status,
            rowsRead: lastSync.rowsRead,
          }
        : null,
      lastBackup: lastBackup
        ? {
            at: lastBackup.startedAt,
            type: lastBackup.type,
            sizeBytes: lastBackup.sizeBytes ? Number(lastBackup.sizeBytes) : null,
          }
        : null,
    };
  }

  /** Recent activity feed, drawn straight from the audit trail. */
  @RequirePermissions('dashboard.read')
  @Get('activity')
  async activity() {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true, action: true, entityType: true, entityLabel: true,
        userName: true, summary: true, createdAt: true,
      },
    });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
