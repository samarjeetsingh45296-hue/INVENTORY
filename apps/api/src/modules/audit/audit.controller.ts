import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditAction, Prisma } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from './audit.service';

/**
 * The audit trail is read-only over HTTP. There is deliberately no delete or
 * edit endpoint: not even a Super Admin can rewrite what happened.
 */
@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('audit.read')
  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: AuditAction,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    const take = Math.min(Number(pageSize) || 50, 200);
    const skip = ((Number(page) || 1) - 1) * take;

    const where: Prisma.AuditLogWhereInput = {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(userId ? { userId } : {}),
      ...(action ? { action } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { entityLabel: { contains: search, mode: 'insensitive' } },
              { userName: { contains: search, mode: 'insensitive' } },
              { summary: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Team level of each actor, by email then name, so the trail verifies who
    // did what at a glance.
    const names = [...new Set(items.map((i) => i.userName).filter(Boolean))];
    const emails = [...new Set(items.map((i) => i.userEmail).filter((e): e is string => !!e))];
    const people = names.length
      ? await this.prisma.employee.findMany({
          where: {
            deletedAt: undefined,
            level: { not: null },
            OR: [{ fullName: { in: names } }, { officialEmail: { in: emails } }],
          },
          select: { fullName: true, officialEmail: true, level: true },
        })
      : [];
    const byEmail = new Map(people.filter((p) => p.officialEmail).map((p) => [p.officialEmail!.toLowerCase(), p.level]));
    const byName = new Map(people.map((p) => [p.fullName.toLowerCase(), p.level]));

    return {
      // BigInt ids are not JSON-serialisable.
      items: items.map((i) => ({
        ...i,
        id: i.id.toString(),
        userLevel: (i.userEmail && byEmail.get(i.userEmail.toLowerCase())) ?? byName.get((i.userName ?? '').toLowerCase()) ?? null,
      })),
      page: Number(page) || 1,
      pageSize: take,
      total,
      totalPages: Math.ceil(total / take),
    };
  }

  /** Everything that ever happened to one record. */
  @RequirePermissions('audit.read')
  @Get('history')
  async history(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    const rows = await this.audit.historyFor(entityType, entityId);
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }
}
