import { Body, Controller, Get, Inject, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllocationStatus, AuditAction, CugStatus, Prisma } from '@prisma/client';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '@inventory/shared';

/**
 * CUG connections: the mobile lines issued to staff, with the handset they
 * sit in. This is the largest single dataset in the contact centre, and the
 * usual question is "whose number is this?", so it is searchable by number,
 * IMEI and holder alike.
 */
@ApiTags('cug')
@Controller('cug')
class CugController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('cug.read')
  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('search') search?: string,
    @Query('status') status?: CugStatus,
  ) {
    const take = Math.min(Number(pageSize) || 25, 200);
    const skip = ((Number(page) || 1) - 1) * take;

    const where: Prisma.CugConnectionWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { mobileNumber: { contains: search } },
              { operator: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              {
                allocations: {
                  some: {
                    status: AllocationStatus.ACTIVE,
                    employee: {
                      OR: [
                        { fullName: { contains: search, mode: 'insensitive' } },
                        { employeeCode: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.cugConnection.findMany({
        where,
        include: {
          branch: { select: { name: true } },
          allocations: {
            where: { status: AllocationStatus.ACTIVE },
            include: {
              employee: {
                select: { id: true, fullName: true, employeeCode: true, process: true },
              },
            },
          },
        },
        orderBy: { mobileNumber: 'asc' },
        take,
        skip,
      }),
      this.prisma.cugConnection.count({ where }),
    ]);

    return {
      items,
      page: Number(page) || 1,
      pageSize: take,
      total,
      totalPages: Math.ceil(total / take),
    };
  }

  /** Every person who has ever held this number. */
  @RequirePermissions('cug.read')
  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.prisma.cugAllocation.findMany({
      where: { connectionId: id },
      include: { employee: { select: { fullName: true, employeeCode: true } } },
      orderBy: { allocatedAt: 'desc' },
    });
  }

  @RequirePermissions('cug.manage')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Prisma.CugConnectionUncheckedUpdateInput,
    @CurrentUser() user: Principal,
  ) {
    const before = await this.prisma.cugConnection.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.cugConnection.update({
      where: { id },
      data: { ...body, updatedById: user.userId },
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'CugConnection',
      entityId: id,
      entityLabel: after.mobileNumber,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: after as unknown as Record<string, unknown>,
    });
    return after;
  }
}

/**
 * Issue and release. Both go through the database's one-active-allocation
 * rule, so a number cannot end up with two holders even under a double click.
 */
@ApiTags('cug')
@Controller('cug')
class CugAllocationController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('cug.allocate')
  @Post(':id/allocate')
  async allocate(
    @Param('id') id: string,
    @Body() body: { employeeId: string; remarks?: string },
    @CurrentUser() user: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const conn = await tx.cugConnection.findFirstOrThrow({ where: { id } });
      const open = await tx.cugAllocation.findFirst({
        where: { connectionId: id, status: AllocationStatus.ACTIVE },
        include: { employee: { select: { fullName: true } } },
      });
      if (open) {
        throw new Error(
          `${conn.mobileNumber} is already issued to ${open.employee.fullName}. ` +
            'Record its return first.',
        );
      }

      const employee = await tx.employee.findFirstOrThrow({ where: { id: body.employeeId } });
      const allocation = await tx.cugAllocation.create({
        data: {
          connectionId: id,
          employeeId: body.employeeId,
          status: AllocationStatus.ACTIVE,
          allocatedAt: new Date(),
          remarks: body.remarks ?? null,
          createdById: user.userId,
        },
      });
      await tx.cugConnection.update({
        where: { id },
        data: { status: CugStatus.ALLOCATED, updatedById: user.userId },
      });

      await this.audit.record({
        action: AuditAction.ALLOCATE,
        entityType: 'CugConnection',
        entityId: id,
        entityLabel: conn.mobileNumber,
        summary: `${conn.mobileNumber} issued to ${employee.fullName} (${employee.employeeCode})`,
        refType: 'CugAllocation',
        refId: allocation.id,
      });
      return allocation;
    });
  }

  @RequirePermissions('cug.allocate')
  @Post(':id/release')
  async release(
    @Param('id') id: string,
    @Body() body: { remarks?: string },
    @CurrentUser() user: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const conn = await tx.cugConnection.findFirstOrThrow({ where: { id } });
      const open = await tx.cugAllocation.findFirst({
        where: { connectionId: id, status: AllocationStatus.ACTIVE },
        include: { employee: { select: { fullName: true } } },
      });
      if (!open) throw new Error(`${conn.mobileNumber} is not currently issued to anyone.`);

      // Closed, never deleted: the chain of custody stays queryable.
      const closed = await tx.cugAllocation.update({
        where: { id: open.id },
        data: {
          status: AllocationStatus.RETURNED,
          releasedAt: new Date(),
          remarks: body.remarks ?? open.remarks,
          updatedById: user.userId,
        },
      });
      await tx.cugConnection.update({
        where: { id },
        data: { status: CugStatus.AVAILABLE, updatedById: user.userId },
      });

      await this.audit.record({
        action: AuditAction.RETURN,
        entityType: 'CugConnection',
        entityId: id,
        entityLabel: conn.mobileNumber,
        summary: `${conn.mobileNumber} returned by ${open.employee.fullName}`,
        refType: 'CugAllocation',
        refId: open.id,
      });
      return closed;
    });
  }
}

@Module({ controllers: [CugController, CugAllocationController] })
export class CugModule {}
