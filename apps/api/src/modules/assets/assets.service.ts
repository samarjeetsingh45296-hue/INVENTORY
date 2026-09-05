import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetEventType,
  AssetStatus,
  AuditAction,
  ChangeRequestType,
  Prisma,
} from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WS_EVENTS } from '@inventory/shared';
import type { Principal } from '@inventory/shared';

@Injectable()
export class AssetsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(params: {
    page: number;
    pageSize: number;
    search?: string;
    categoryId?: string;
    status?: AssetStatus;
    branchId?: string;
    locationId?: string;
    includeArchived?: boolean;
    principal: Principal;
  }) {
    const take = Math.min(params.pageSize, 200);
    const { principal, search } = params;

    // An Employee may only ever see what is in their own hands; a Team Leader
    // sees their reporting line. Enforced here, not in the UI.
    const scopeFilter = await this.visibilityFilter(principal);

    const where: Prisma.AssetWhereInput = {
      ...scopeFilter,
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.branchId ? { branchId: params.branchId } : {}),
      ...(params.locationId ? { locationId: params.locationId } : {}),
      ...(params.includeArchived ? { deletedAt: undefined } : {}),
      ...(search
        ? {
            OR: [
              { assetTag: { contains: search, mode: 'insensitive' } },
              { serialNumber: { contains: search, mode: 'insensitive' } },
              { model: { contains: search, mode: 'insensitive' } },
              { make: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        include: {
          category: true,
          branch: { select: { id: true, name: true } },
          location: { select: { id: true, name: true, path: true } },
          allocations: {
            where: { status: 'ACTIVE' },
            include: { employee: { select: { fullName: true, employeeCode: true, level: true} } },
          },
        },
        orderBy: { assetTag: 'asc' },
        take,
        skip: (params.page - 1) * take,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return { items, page: params.page, pageSize: take, total, totalPages: Math.ceil(total / take) };
  }

  /**
   * Translates a role into a database filter.
   * `asset.read` sees everything in scope; without it, the caller is limited
   * to their own or their team's equipment.
   */
  private async visibilityFilter(principal: Principal): Promise<Prisma.AssetWhereInput> {
    const branchFilter: Prisma.AssetWhereInput = principal.branchScope.length
      ? { branchId: { in: principal.branchScope } }
      : {};

    if (principal.permissions.includes('asset.read')) return branchFilter;

    if (principal.permissions.includes('asset.read_team') && principal.employeeId) {
      const reports = await this.prisma.employee.findMany({
        where: { reportingManagerId: principal.employeeId },
        select: { id: true },
      });
      const ids = [principal.employeeId, ...reports.map((r) => r.id)];
      return { ...branchFilter, currentHolderEmployeeId: { in: ids } };
    }

    if (principal.permissions.includes('asset.read_own') && principal.employeeId) {
      return { ...branchFilter, currentHolderEmployeeId: principal.employeeId };
    }

    // No applicable read permission: match nothing rather than everything.
    return { id: '00000000-0000-0000-0000-000000000000' };
  }

  /** Categories for the asset form's dropdown. */
  async listCategories() {
    return this.prisma.assetCategory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, tagPrefix: true },
    });
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, deletedAt: undefined },
      include: {
        category: true,
        branch: true,
        location: true,
        vendor: true,
        components: true,
        allocations: {
          include: { employee: { select: { fullName: true, employeeCode: true, level: true} } },
          orderBy: { allocatedAt: 'desc' },
        },
        repairTickets: { orderBy: { reportedAt: 'desc' } },
        events: { orderBy: { occurredAt: 'desc' }, take: 100 },
      },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async create(data: Prisma.AssetUncheckedCreateInput, principal: Principal) {
    const created = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: { ...data, createdById: principal.userId },
      });
      await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          eventType: AssetEventType.CREATED,
          summary: `Added to inventory by ${principal.displayName}`,
          toValue: { assetTag: asset.assetTag, status: asset.status },
          actorUserId: principal.userId,
          actorName: principal.displayName,
        },
      });
      return asset;
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Asset',
      entityId: created.id,
      entityLabel: created.assetTag,
      newValue: created as unknown as Record<string, unknown>,
      summary: `Added asset ${created.assetTag}`,
    });

    this.realtime.emitChange({
      event: WS_EVENTS.ASSET_CREATED,
      entityType: 'Asset',
      entityId: created.id,
      branchId: created.branchId,
      actorName: principal.displayName,
      data: created,
    });

    return created;
  }

  async update(id: string, data: Prisma.AssetUncheckedUpdateInput, principal: Principal) {
    const before = await this.prisma.asset.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Asset not found');

    const after = await this.prisma.asset.update({
      where: { id },
      data: { ...data, updatedById: principal.userId },
    });

    const { changed } = this.audit.diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );

    if (changed.length) {
      await this.prisma.assetEvent.create({
        data: {
          assetId: id,
          eventType: changed.includes('status')
            ? AssetEventType.STATUS_CHANGED
            : changed.includes('locationId')
              ? AssetEventType.LOCATION_CHANGED
              : AssetEventType.UPDATED,
          summary: `${changed.join(', ')} updated by ${principal.displayName}`,
          fromValue: pick(before as never, changed) as Prisma.InputJsonValue,
          toValue: pick(after as never, changed) as Prisma.InputJsonValue,
          actorUserId: principal.userId,
          actorName: principal.displayName,
        },
      });
    }

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Asset',
      entityId: id,
      entityLabel: after.assetTag,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: after as unknown as Record<string, unknown>,
    });

    this.realtime.emitChange({
      event: WS_EVENTS.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: id,
      branchId: after.branchId,
      actorName: principal.displayName,
      data: after,
    });

    return after;
  }

  /**
   * Archiving an asset is a sensitive change, so it does not happen directly:
   * it raises an approval request and only takes effect once approved. The
   * asset stays fully visible and reportable in the meantime.
   */
  async requestArchive(id: string, reason: string, principal: Principal) {
    const asset = await this.prisma.asset.findFirst({
      where: { id },
      include: { allocations: { where: { status: 'ACTIVE' } } },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    if (asset.allocations.length > 0) {
      throw new ConflictException(
        `${asset.assetTag} is currently issued to ${asset.allocations[0]!.holderLabel}. ` +
          'Record its return before archiving.',
      );
    }

    // A Super Admin holds the final approval stage, so routing their own
    // request through a queue only they can clear is ceremony with no control
    // value. Apply it directly and record who did it. Everyone else raises a
    // request, and the asset stays fully active until it is approved.
    if (principal.permissions.includes('approval.decide_super')) {
      const archived = await this.applyArchive(id, reason, principal.userId);
      return {
        request: null,
        applied: true,
        asset: archived,
        message:
          `${asset.assetTag} archived. It is retained in full, with its ` +
          'allocation history and timeline, and can be restored at any time.',
      };
    }

    const request = await this.prisma.approvalRequest.create({
      data: {
        requestNo: `AR-${Date.now().toString(36).toUpperCase()}`,
        changeType: ChangeRequestType.ASSET_DELETE,
        targetTable: 'assets',
        targetId: id,
        targetLabel: asset.assetTag,
        payload: { op: 'archive', assetId: id, reason },
        reason,
        raisedById: principal.userId,
        raisedByName: principal.displayName,
        steps: {
          create: [
            { stage: 'MANAGER', sequence: 1, assignedRoleKey: 'TEAM_LEADER' },
            { stage: 'ADMIN', sequence: 2, assignedRoleKey: 'HR_ADMIN' },
          ],
        },
      },
      include: { steps: true },
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Asset',
      entityId: id,
      entityLabel: asset.assetTag,
      summary: `Archive requested by ${principal.displayName}: ${reason}. Awaiting approval.`,
      refType: 'ApprovalRequest',
      refId: request.id,
    });

    return {
      request,
      applied: false,
      asset: null,
      message:
        'Archiving needs approval. The asset remains active and fully visible ' +
        'until every approval step is complete.',
    };
  }

  /** Called by the approval engine once an archive request is fully approved. */
  async applyArchive(id: string, reason: string, actorId: string | null) {
    const archived = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedById: actorId,
          isActive: false,
          archivedAt: new Date(),
          archiveReason: reason,
          status: AssetStatus.RETIRED,
        },
      });
      await tx.assetEvent.create({
        data: {
          assetId: id,
          eventType: AssetEventType.ARCHIVED,
          summary: `Archived: ${reason}`,
          actorUserId: actorId,
          actorName: 'Approved change',
        },
      });
      return asset;
    });

    await this.audit.record({
      action: AuditAction.SOFT_DELETE,
      entityType: 'Asset',
      entityId: id,
      entityLabel: archived.assetTag,
      summary:
        `Archived after approval: ${reason}. The record, its allocations and its ` +
        'full history are retained permanently.',
    });

    this.realtime.emitChange({
      event: WS_EVENTS.ASSET_ARCHIVED,
      entityType: 'Asset',
      entityId: id,
      branchId: archived.branchId,
      data: archived,
    });

    return archived;
  }

  async restore(id: string, principal: Principal) {
    const restored = await this.prisma.asset.update({
      where: { id },
      data: {
        deletedAt: null,
        deletedById: null,
        isActive: true,
        archivedAt: null,
        archiveReason: null,
        status: AssetStatus.IN_STOCK,
        updatedById: principal.userId,
      },
    });

    await this.prisma.assetEvent.create({
      data: {
        assetId: id,
        eventType: AssetEventType.RESTORED,
        summary: `Restored from archive by ${principal.displayName}`,
        actorUserId: principal.userId,
        actorName: principal.displayName,
      },
    });

    await this.audit.record({
      action: AuditAction.RESTORE,
      entityType: 'Asset',
      entityId: id,
      entityLabel: restored.assetTag,
      summary: 'Restored from archive',
    });

    this.realtime.emitChange({
      event: WS_EVENTS.ASSET_RESTORED,
      entityType: 'Asset',
      entityId: id,
      branchId: restored.branchId,
      actorName: principal.displayName,
      data: restored,
    });

    return restored;
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));
}
