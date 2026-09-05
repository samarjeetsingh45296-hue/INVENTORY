import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WS_EVENTS } from '@inventory/shared';
import type { Principal } from '@inventory/shared';

@Injectable()
export class EmployeesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(params: {
    page: number;
    pageSize: number;
    search?: string;
    branchId?: string;
    departmentId?: string;
    status?: string;
    includeArchived?: boolean;
    principal: Principal;
  }) {
    const { page, pageSize, search, principal } = params;
    const take = Math.min(pageSize, 200);

    const where: Prisma.EmployeeWhereInput = {
      // Users limited to certain branches never see beyond them.
      ...(principal.branchScope.length
        ? { branchId: { in: principal.branchScope } }
        : {}),
      ...(params.branchId ? { branchId: params.branchId } : {}),
      ...(params.departmentId ? { departmentId: params.departmentId } : {}),
      ...(params.status ? { employmentStatus: params.status as never } : {}),
      ...(params.includeArchived ? { deletedAt: undefined } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { employeeCode: { contains: search, mode: 'insensitive' } },
              { officialEmail: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: { branch: true, department: true, designation: true },
        orderBy: { fullName: 'asc' },
        take,
        skip: (page - 1) * take,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, page, pageSize: take, total, totalPages: Math.ceil(total / take) };
  }

  /** One employee with everything currently in their custody. */
  async findOne(id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: undefined },
      include: {
        branch: true,
        department: true,
        designation: true,
        reportingManager: { select: { id: true, fullName: true, employeeCode: true, level: true} },
        allocations: {
          where: { status: 'ACTIVE' },
          include: { asset: { include: { category: true } } },
        },
        lockerAllocations: { where: { status: 'ACTIVE' }, include: { locker: true } },
        cugAllocations: { where: { status: 'ACTIVE' }, include: { connection: true } },
        workstationAllocations: { where: { status: 'ACTIVE' }, include: { workstation: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  /**
   * Full custody history: every asset this person has ever held, including
   * items already returned. Retained permanently.
   */
  async history(id: string) {
    return this.prisma.assetAllocation.findMany({
      where: { employeeId: id },
      include: { asset: { include: { category: true } } },
      orderBy: { allocatedAt: 'desc' },
    });
  }

  async create(data: Prisma.EmployeeUncheckedCreateInput, principal: Principal) {
    const created = await this.prisma.employee.create({
      data: {
        ...data,
        fullName: [data.firstName, data.lastName].filter(Boolean).join(' '),
        createdById: principal.userId,
      },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Employee',
      entityId: created.id,
      entityLabel: `${created.fullName} (${created.employeeCode})`,
      newValue: created as unknown as Record<string, unknown>,
      summary: `Added employee ${created.fullName}`,
    });

    this.realtime.emitChange({
      event: WS_EVENTS.EMPLOYEE_UPDATED,
      entityType: 'Employee',
      entityId: created.id,
      branchId: created.branchId,
      actorName: principal.displayName,
      data: created,
    });

    return created;
  }

  async update(id: string, data: Prisma.EmployeeUncheckedUpdateInput, principal: Principal) {
    const before = await this.prisma.employee.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Employee not found');

    const patch: Prisma.EmployeeUncheckedUpdateInput = {
      ...data,
      updatedById: principal.userId,
    };
    if (data.firstName !== undefined || data.lastName !== undefined) {
      patch.fullName = [
        (data.firstName as string) ?? before.firstName,
        (data.lastName as string) ?? before.lastName,
      ]
        .filter(Boolean)
        .join(' ');
    }

    const after = await this.prisma.employee.update({ where: { id }, data: patch });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Employee',
      entityId: id,
      entityLabel: `${after.fullName} (${after.employeeCode})`,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: after as unknown as Record<string, unknown>,
    });

    this.realtime.emitChange({
      event: WS_EVENTS.EMPLOYEE_UPDATED,
      entityType: 'Employee',
      entityId: id,
      branchId: after.branchId,
      actorName: principal.displayName,
      data: after,
    });

    return after;
  }

  /**
   * Archive, never delete.
   *
   * Refused while the person still holds equipment: closing their record would
   * otherwise strand assets with no accountable holder.
   */
  async archive(id: string, reason: string, principal: Principal) {
    const employee = await this.prisma.employee.findFirst({
      where: { id },
      include: { allocations: { where: { status: 'ACTIVE' } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    if (employee.allocations.length > 0) {
      throw new ConflictException(
        `${employee.fullName} still holds ${employee.allocations.length} item(s). ` +
          'Record the returns first, then archive the record.',
      );
    }

    const archived = await this.prisma.employee.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedById: principal.userId,
        isActive: false,
        remarks: reason,
      },
    });

    await this.audit.record({
      action: AuditAction.SOFT_DELETE,
      entityType: 'Employee',
      entityId: id,
      entityLabel: `${employee.fullName} (${employee.employeeCode})`,
      summary: `Archived: ${reason}. The record and its full history are retained.`,
    });

    return archived;
  }

  async restore(id: string, principal: Principal) {
    const restored = await this.prisma.employee.update({
      where: { id },
      data: { deletedAt: null, deletedById: null, isActive: true, updatedById: principal.userId },
    });
    await this.audit.record({
      action: AuditAction.RESTORE,
      entityType: 'Employee',
      entityId: id,
      entityLabel: `${restored.fullName} (${restored.employeeCode})`,
      summary: 'Restored from archive',
    });
    return restored;
  }
}
