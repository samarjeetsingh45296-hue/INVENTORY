import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationHolderType,
  AllocationStatus,
  AssetCondition,
  AssetEventType,
  AssetStatus,
  AuditAction,
} from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WS_EVENTS } from '@inventory/shared';
import type { Principal } from '@inventory/shared';

export interface AllocateInput {
  assetId: string;
  employeeId?: string;
  holderType?: AllocationHolderType;
  holderRefId?: string;
  holderLabel?: string;
  allocatedAt?: Date;
  conditionOut?: AssetCondition;
  expectedReturnAt?: Date;
  remarks?: string;
}

export interface ReturnInput {
  allocationId: string;
  returnedAt?: Date;
  conditionIn: AssetCondition;
  returnRemarks?: string;
  /** Send straight to repair instead of back into stock. */
  sendToRepair?: boolean;
}

/** Statuses from which an asset can be handed to somebody. */
const ALLOCATABLE = new Set<AssetStatus>([AssetStatus.IN_STOCK, AssetStatus.RESERVED]);

@Injectable()
export class AllocationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Hands an asset to a holder.
   *
   * Everything happens in one transaction: the allocation row, the asset's
   * status, the denormalised holder cache and the timeline entry either all
   * land or none of them do. A partial write here would mean an asset the
   * system thinks is in two places at once.
   */
  async allocate(input: AllocateInput, principal: Principal) {
    const holderType = input.holderType ?? AllocationHolderType.EMPLOYEE;

    if (holderType === AllocationHolderType.EMPLOYEE && !input.employeeId) {
      throw new BadRequestException('Choose the employee this asset is being issued to');
    }

    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: input.assetId },
        include: { category: true, allocations: { where: { status: AllocationStatus.ACTIVE } } },
      });
      if (!asset) throw new NotFoundException('Asset not found');

      if (asset.allocations.length > 0) {
        const current = asset.allocations[0]!;
        throw new ConflictException(
          `${asset.assetTag} is already issued (allocation ${current.id}). ` +
            'Record its return first, or use Transfer to move it directly.',
        );
      }

      if (!ALLOCATABLE.has(asset.status)) {
        throw new ConflictException(
          `${asset.assetTag} cannot be issued while its status is ${asset.status}.`,
        );
      }

      let holderLabel = input.holderLabel ?? null;
      if (input.employeeId) {
        const employee = await tx.employee.findFirst({ where: { id: input.employeeId } });
        if (!employee) throw new NotFoundException('Employee not found');
        if (employee.employmentStatus === 'RESIGNED' || employee.employmentStatus === 'TERMINATED') {
          throw new ConflictException(
            `${employee.fullName} is marked ${employee.employmentStatus} and cannot be issued equipment.`,
          );
        }
        holderLabel = `${employee.fullName} (${employee.employeeCode})`;
      }

      const allocatedAt = input.allocatedAt ?? new Date();

      const allocation = await tx.assetAllocation.create({
        data: {
          assetId: asset.id,
          holderType,
          employeeId: input.employeeId ?? null,
          holderRefId: input.holderRefId ?? null,
          holderLabel,
          status: AllocationStatus.ACTIVE,
          allocatedAt,
          allocatedById: principal.userId,
          conditionOut: input.conditionOut ?? AssetCondition.GOOD,
          expectedReturnAt: input.expectedReturnAt ?? null,
          remarks: input.remarks ?? null,
          createdById: principal.userId,
        },
      });

      await tx.asset.update({
        where: { id: asset.id },
        data: {
          status: AssetStatus.ALLOCATED,
          currentHolderEmployeeId: input.employeeId ?? null,
          currentAllocationId: allocation.id,
          updatedById: principal.userId,
        },
      });

      await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          eventType: AssetEventType.ALLOCATED,
          summary: `Issued to ${holderLabel ?? holderType}`,
          fromValue: { status: asset.status, holder: null },
          toValue: { status: AssetStatus.ALLOCATED, holder: holderLabel },
          refType: 'AssetAllocation',
          refId: allocation.id,
          actorUserId: principal.userId,
          actorName: principal.displayName,
        },
      });

      await this.audit.record({
        action: AuditAction.ALLOCATE,
        entityType: 'Asset',
        entityId: asset.id,
        entityLabel: asset.assetTag,
        oldValue: { status: asset.status, holder: null },
        newValue: { status: AssetStatus.ALLOCATED, holder: holderLabel },
        summary: `${asset.assetTag} issued to ${holderLabel ?? holderType}`,
        refType: 'AssetAllocation',
        refId: allocation.id,
      });

      this.realtime.emitChange({
        event: WS_EVENTS.ALLOCATION_CREATED,
        entityType: 'Asset',
        entityId: asset.id,
        branchId: asset.branchId,
        actorName: principal.displayName,
        data: { allocation, assetTag: asset.assetTag, holderLabel },
      });

      return allocation;
    });
  }

  /**
   * Records a return. The allocation row is CLOSED, never deleted, so the
   * chain of custody survives intact.
   */
  async returnAsset(input: ReturnInput, principal: Principal) {
    return this.prisma.$transaction(async (tx) => {
      const allocation = await tx.assetAllocation.findFirst({
        where: { id: input.allocationId },
        include: { asset: true, employee: true },
      });
      if (!allocation) throw new NotFoundException('Allocation not found');

      if (allocation.status !== AllocationStatus.ACTIVE) {
        throw new ConflictException(
          `This allocation is already ${allocation.status}; it was closed on ` +
            `${allocation.returnedAt?.toISOString().slice(0, 10)}.`,
        );
      }

      const returnedAt = input.returnedAt ?? new Date();
      if (returnedAt < allocation.allocatedAt) {
        throw new BadRequestException('The return date cannot be before the issue date');
      }

      const closed = await tx.assetAllocation.update({
        where: { id: allocation.id },
        data: {
          status: AllocationStatus.RETURNED,
          returnedAt,
          returnedToById: principal.userId,
          conditionIn: input.conditionIn,
          returnRemarks: input.returnRemarks ?? null,
          updatedById: principal.userId,
        },
      });

      // Damaged kit goes to repair rather than straight back onto the shelf.
      const damaged =
        input.sendToRepair ||
        input.conditionIn === AssetCondition.DAMAGED ||
        input.conditionIn === AssetCondition.BEYOND_REPAIR;

      const nextStatus = damaged ? AssetStatus.IN_REPAIR : AssetStatus.IN_STOCK;

      await tx.asset.update({
        where: { id: allocation.assetId },
        data: {
          status: nextStatus,
          condition: input.conditionIn,
          currentHolderEmployeeId: null,
          currentAllocationId: null,
          updatedById: principal.userId,
        },
      });

      await tx.assetEvent.create({
        data: {
          assetId: allocation.assetId,
          eventType: AssetEventType.RETURNED,
          summary:
            `Returned by ${allocation.holderLabel ?? 'holder'} in ${input.conditionIn} condition` +
            (damaged ? ' and sent for repair' : ''),
          fromValue: { status: AssetStatus.ALLOCATED, holder: allocation.holderLabel },
          toValue: { status: nextStatus, condition: input.conditionIn },
          refType: 'AssetAllocation',
          refId: allocation.id,
          actorUserId: principal.userId,
          actorName: principal.displayName,
        },
      });

      await this.audit.record({
        action: AuditAction.RETURN,
        entityType: 'Asset',
        entityId: allocation.assetId,
        entityLabel: allocation.asset.assetTag,
        oldValue: { status: AssetStatus.ALLOCATED, holder: allocation.holderLabel },
        newValue: { status: nextStatus, condition: input.conditionIn },
        summary: `${allocation.asset.assetTag} returned by ${allocation.holderLabel}`,
        refType: 'AssetAllocation',
        refId: allocation.id,
      });

      this.realtime.emitChange({
        event: WS_EVENTS.ALLOCATION_RETURNED,
        entityType: 'Asset',
        entityId: allocation.assetId,
        branchId: allocation.asset.branchId,
        actorName: principal.displayName,
        data: { allocation: closed, assetTag: allocation.asset.assetTag, nextStatus },
      });

      return closed;
    });
  }

  /**
   * Moves an asset from one holder to another in a single step: closes the
   * current allocation as TRANSFERRED and opens the next one, so the timeline
   * reads as one handover rather than an unexplained gap.
   */
  async transfer(
    input: { allocationId: string; toEmployeeId: string; conditionIn: AssetCondition; remarks?: string },
    principal: Principal,
  ) {
    const existing = await this.prisma.assetAllocation.findFirst({
      where: { id: input.allocationId },
      include: { asset: true },
    });
    if (!existing) throw new NotFoundException('Allocation not found');
    if (existing.status !== AllocationStatus.ACTIVE) {
      throw new ConflictException('That allocation is already closed');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.assetAllocation.update({
        where: { id: existing.id },
        data: {
          status: AllocationStatus.TRANSFERRED,
          returnedAt: new Date(),
          returnedToById: principal.userId,
          conditionIn: input.conditionIn,
          returnRemarks: input.remarks ?? 'Transferred to another holder',
          updatedById: principal.userId,
        },
      });
      await tx.asset.update({
        where: { id: existing.assetId },
        data: {
          status: AssetStatus.IN_STOCK,
          currentHolderEmployeeId: null,
          currentAllocationId: null,
        },
      });
    });

    const next = await this.allocate(
      {
        assetId: existing.assetId,
        employeeId: input.toEmployeeId,
        conditionOut: input.conditionIn,
        remarks: input.remarks,
      },
      principal,
    );

    this.realtime.emitChange({
      event: WS_EVENTS.ALLOCATION_TRANSFERRED,
      entityType: 'Asset',
      entityId: existing.assetId,
      branchId: existing.asset.branchId,
      actorName: principal.displayName,
      data: { from: existing.holderLabel, allocation: next },
    });

    return next;
  }

  /** The complete, permanent custody chain for one asset. */
  async historyForAsset(assetId: string) {
    const [allocations, events] = await Promise.all([
      this.prisma.assetAllocation.findMany({
        where: { assetId },
        include: { employee: { select: { fullName: true, employeeCode: true } } },
        orderBy: { allocatedAt: 'desc' },
      }),
      this.prisma.assetEvent.findMany({
        where: { assetId },
        orderBy: { occurredAt: 'desc' },
        take: 500,
      }),
    ]);
    return { allocations, events };
  }
}
