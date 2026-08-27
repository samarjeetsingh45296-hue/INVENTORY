import { Body, Controller, Get, Inject, Module, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllocationStatus, AuditAction, LockerStatus, Prisma } from '@prisma/client';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '@inventory/shared';

@ApiTags('lockers')
@Controller('lockers')
class LockersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('locker.read')
  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('search') search?: string,
    @Query('status') status?: LockerStatus,
  ) {
    const take = Math.min(Number(pageSize) || 50, 200);
    const where: Prisma.LockerWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { lockerNo: { contains: search, mode: 'insensitive' } },
              { keyNumber: { contains: search, mode: 'insensitive' } },
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
      this.prisma.locker.findMany({
        where,
        include: {
          branch: { select: { name: true } },
          allocations: {
            where: { status: AllocationStatus.ACTIVE },
            include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
          },
        },
        orderBy: { lockerNo: 'asc' },
        take,
        skip: ((Number(page) || 1) - 1) * take,
      }),
      this.prisma.locker.count({ where }),
    ]);

    return { items, page: Number(page) || 1, pageSize: take, total, totalPages: Math.ceil(total / take) };
  }

  @RequirePermissions('locker.read')
  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.prisma.lockerAllocation.findMany({
      where: { lockerId: id },
      include: { employee: { select: { fullName: true, employeeCode: true } } },
      orderBy: { allocatedAt: 'desc' },
    });
  }

  @RequirePermissions('locker.allocate')
  @Post(':id/allocate')
  async allocate(
    @Param('id') id: string,
    @Body() body: { employeeId: string; keyIssued?: boolean },
    @CurrentUser() user: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locker = await tx.locker.findFirstOrThrow({ where: { id } });
      const open = await tx.lockerAllocation.findFirst({
        where: { lockerId: id, status: AllocationStatus.ACTIVE },
        include: { employee: { select: { fullName: true } } },
      });
      if (open) {
        throw new Error(
          `Locker ${locker.lockerNo} is already held by ${open.employee.fullName}.`,
        );
      }
      const employee = await tx.employee.findFirstOrThrow({ where: { id: body.employeeId } });
      const allocation = await tx.lockerAllocation.create({
        data: {
          lockerId: id,
          employeeId: body.employeeId,
          status: AllocationStatus.ACTIVE,
          allocatedAt: new Date(),
          keyIssued: body.keyIssued ?? true,
          createdById: user.userId,
        },
      });
      await tx.locker.update({
        where: { id },
        data: { status: LockerStatus.ALLOCATED, updatedById: user.userId },
      });
      await this.audit.record({
        action: AuditAction.ALLOCATE,
        entityType: 'Locker',
        entityId: id,
        entityLabel: `Locker ${locker.lockerNo}`,
        summary: `Locker ${locker.lockerNo} issued to ${employee.fullName}`,
      });
      return allocation;
    });
  }

  @RequirePermissions('locker.allocate')
  @Post(':id/release')
  async release(
    @Param('id') id: string,
    @Body() body: { keyReturned?: boolean },
    @CurrentUser() user: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locker = await tx.locker.findFirstOrThrow({ where: { id } });
      const open = await tx.lockerAllocation.findFirst({
        where: { lockerId: id, status: AllocationStatus.ACTIVE },
        include: { employee: { select: { fullName: true } } },
      });
      if (!open) throw new Error(`Locker ${locker.lockerNo} is not currently held by anyone.`);

      const closed = await tx.lockerAllocation.update({
        where: { id: open.id },
        data: {
          status: AllocationStatus.RETURNED,
          releasedAt: new Date(),
          keyReturned: body.keyReturned ?? true,
          updatedById: user.userId,
        },
      });
      await tx.locker.update({
        where: { id },
        data: { status: LockerStatus.AVAILABLE, updatedById: user.userId },
      });
      await this.audit.record({
        action: AuditAction.RETURN,
        entityType: 'Locker',
        entityId: id,
        entityLabel: `Locker ${locker.lockerNo}`,
        summary: `Locker ${locker.lockerNo} released by ${open.employee.fullName}`,
      });
      return closed;
    });
  }
}

@Module({ controllers: [LockersController] })
export class LockersModule {}
