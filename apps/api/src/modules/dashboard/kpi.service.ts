import { Inject, Injectable } from '@nestjs/common';
import { AssetStatus } from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';

/**
 * Every figure the dashboard shows, computed in one place.
 *
 * These are aggregates over live rows, not cached counters: they cannot drift
 * from the data the way a maintained tally does, and at this size (a few
 * thousand rows) the cost is a handful of indexed counts.
 */
@Injectable()
export class KpiService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrisma) {}

  async summary() {
    const [
      assetsTotal, employeesTotal, workstationsTotal, cugTotal, lockersTotal,
      repairsTotal, allocationsActive,
    ] = await Promise.all([
      this.prisma.asset.count(),
      this.prisma.employee.count(),
      this.prisma.workstation.count(),
      this.prisma.cugConnection.count(),
      this.prisma.locker.count(),
      this.prisma.repairTicket.count(),
      this.prisma.assetAllocation.count({ where: { status: 'ACTIVE' } }),
    ]);

    const [byStatusRaw, byCategoryRaw] = await Promise.all([
      this.prisma.asset.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['categoryId'], _count: { _all: true } }),
    ]);

    const categories = await this.prisma.assetCategory.findMany({
      where: { id: { in: byCategoryRaw.map((c) => c.categoryId) } },
      select: { id: true, name: true },
    });

    const byCategory = byCategoryRaw
      .map((c) => ({
        name: categories.find((x) => x.id === c.categoryId)?.name ?? 'Uncategorised',
        count: c._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const byStatus = byStatusRaw
      .map((s) => ({ status: s.status, count: s._count._all }))
      .sort((a, b) => b.count - a.count);

    const allocated = byStatus.find((s) => s.status === AssetStatus.ALLOCATED)?.count ?? 0;
    const inStock = byStatus.find((s) => s.status === AssetStatus.IN_STOCK)?.count ?? 0;
    const inRepair = byStatus.find((s) => s.status === AssetStatus.IN_REPAIR)?.count ?? 0;

    return {
      totals: {
        assets: assetsTotal,
        employees: employeesTotal,
        workstations: workstationsTotal,
        cug: cugTotal,
        lockers: lockersTotal,
        repairs: repairsTotal,
        allocations: allocationsActive,
      },
      assets: {
        byStatus,
        byCategory,
        allocated,
        inStock,
        inRepair,
        utilisationPct: assetsTotal ? Math.round((allocated / assetsTotal) * 100) : 0,
      },
    };
  }

  /**
   * Workstation coverage. The "Missing:" note is written by the importer, and
   * parsing it here keeps the gap list in one place rather than in every screen
   * that wants to know which seats are short of something.
   */
  async workstations() {
    const all = await this.prisma.workstation.findMany({
      select: { id: true, seatCode: true, notes: true, location: { select: { name: true } } },
    });

    const missingCounts = new Map<string, number>();
    const byWing = new Map<string, { complete: number; gaps: number }>();

    for (const w of all) {
      const wing = w.location?.name ?? 'Unassigned';
      const bucket = byWing.get(wing) ?? { complete: 0, gaps: 0 };
      const missing = w.notes?.match(/Missing:\s*([^|]+)/)?.[1]?.trim();

      if (missing) {
        bucket.gaps += 1;
        for (const item of missing.split(/,\s*/).filter(Boolean)) {
          missingCounts.set(item, (missingCounts.get(item) ?? 0) + 1);
        }
      } else {
        bucket.complete += 1;
      }
      byWing.set(wing, bucket);
    }

    const withGaps = [...byWing.values()].reduce((n, b) => n + b.gaps, 0);

    return {
      total: all.length,
      complete: all.length - withGaps,
      withGaps,
      completionPct: all.length ? Math.round(((all.length - withGaps) / all.length) * 100) : 0,
      byWing: [...byWing.entries()]
        .map(([wing, b]) => ({ wing, ...b, total: b.complete + b.gaps }))
        .sort((a, b) => a.wing.localeCompare(b.wing)),
      missingByItem: [...missingCounts.entries()]
        .map(([item, count]) => ({ item, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /** Utilisation of the pooled resources: mobile lines and lockers. */
  async utilisation() {
    const [cugTotal, cugAllocated, lockerTotal, lockerHeld] = await Promise.all([
      this.prisma.cugConnection.count(),
      this.prisma.cugAllocation.count({ where: { status: 'ACTIVE' } }),
      this.prisma.locker.count(),
      this.prisma.lockerAllocation.count({ where: { status: 'ACTIVE' } }),
    ]);

    return {
      cug: {
        total: cugTotal,
        allocated: cugAllocated,
        available: cugTotal - cugAllocated,
        pct: cugTotal ? Math.round((cugAllocated / cugTotal) * 100) : 0,
      },
      lockers: {
        total: lockerTotal,
        held: lockerHeld,
        free: lockerTotal - lockerHeld,
        pct: lockerTotal ? Math.round((lockerHeld / lockerTotal) * 100) : 0,
      },
    };
  }

  async repairs() {
    const CLOSED = ['RETURNED_TO_STOCK', 'CANCELLED', 'UNREPAIRABLE'] as const;
    const [total, open, agg, recovered] = await Promise.all([
      this.prisma.repairTicket.count(),
      this.prisma.repairTicket.count({ where: { status: { notIn: CLOSED as never } } }),
      this.prisma.repairTicket.aggregate({ _sum: { actualCost: true } }),
      this.prisma.repairTicket.count({ where: { chargedToEmployee: true } }),
    ]);

    const byStatus = await this.prisma.repairTicket.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    return {
      total,
      open,
      closed: total - open,
      spend: agg._sum.actualCost ? Number(agg._sum.actualCost) : 0,
      recoveredFromEmployees: recovered,
      byStatus: byStatus
        .map((s) => ({ status: s.status, count: s._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Things that are wrong with the data itself.
   *
   * Surfacing these is the point: an import that quietly swallowed 68 people
   * with no MIS number would be worse than one that says so on the front page.
   */
  async dataQuality() {
    const [needMisNumber, unassignedAssets, employeesWithKit, archivedAssets] =
      await Promise.all([
        this.prisma.employee.count({ where: { employeeCode: { startsWith: 'NOMIS-' } } }),
        this.prisma.asset.count({ where: { status: 'IN_STOCK' } }),
        this.prisma.employee.count({
          where: { allocations: { some: { status: 'ACTIVE' } } },
        }),
        this.prisma.asset.count({ where: { deletedAt: { not: null } } }),
      ]);

    const employeesTotal = await this.prisma.employee.count();

    // Keys issued more than once across the sheet's history.
    const duplicateKeys = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM (
        SELECT "keyNumber" FROM lockers
        WHERE "keyNumber" IS NOT NULL AND "deletedAt" IS NULL
        GROUP BY "keyNumber" HAVING count(*) > 1
      ) d
    `;

    return {
      employeesNeedingMisNumber: needMisNumber,
      employeesWithEquipment: employeesWithKit,
      employeesWithoutEquipment: employeesTotal - employeesWithKit,
      unassignedAssets,
      archivedAssets,
      duplicateLockerKeys: Number(duplicateKeys[0]?.n ?? 0),
    };
  }

  /** Everything, in one round trip. */
  async all() {
    const [summary, workstations, utilisation, repairs, dataQuality] = await Promise.all([
      this.summary(),
      this.workstations(),
      this.utilisation(),
      this.repairs(),
      this.dataQuality(),
    ]);
    return { ...summary, workstations, utilisation, repairs, dataQuality };
  }
}
