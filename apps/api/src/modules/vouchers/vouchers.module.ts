import {
  BadRequestException, Body, Controller, Get, Inject, Module, Param, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditAction, Prisma, VoucherStatus } from '@prisma/client';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '@inventory/shared';

/**
 * PVR movie cards, and any reward voucher like them.
 *
 * One row is one card. The printed number repeats across a book of ten, so
 * lists group by number to show how many of each book are left.
 */
@ApiTags('vouchers')
@Controller('vouchers')
class VouchersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('asset.read')
  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '200',
    @Query('search') search?: string,
    @Query('status') status?: VoucherStatus,
  ) {
    const take = Math.min(Number(pageSize) || 200, 500);
    const where: Prisma.VoucherWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { voucherNo: { contains: search } },
              { issuedToName: { contains: search, mode: 'insensitive' } },
              { purpose: { contains: search, mode: 'insensitive' } },
              { issuedTo: { fullName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total, byStatus] = await Promise.all([
      this.prisma.voucher.findMany({
        where,
        include: {
          issuedTo: { select: { id: true, fullName: true, employeeCode: true } },
        },
        // Serial number is the card's position in the drawer, so ordering by
        // it lists the cards the way somebody counting them would.
        orderBy: [{ serialNo: 'asc' }, { voucherNo: 'asc' }],
        take,
        skip: ((Number(page) || 1) - 1) * take,
      }),
      this.prisma.voucher.count({ where }),
      this.prisma.voucher.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return {
      items: items.map((v) => ({
        ...v,
        faceValue: v.faceValue ? Number(v.faceValue) : null,
      })),
      summary: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      },
      page: Number(page) || 1,
      pageSize: take,
      total,
      totalPages: Math.ceil(total / take),
    };
  }
  /**
   * Set a card's state, and the holder that goes with it.
   *
   * Status drives the record: moving to ISSUED requires a name and stamps the
   * date; moving back to AVAILABLE clears both, because a card in the drawer
   * has no holder. The names of previous holders are not lost - every change
   * is on the audit trail.
   */
  @RequirePermissions('asset.update')
  @Post(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body() body: { status: VoucherStatus; issuedToName?: string; employeeId?: string; notes?: string },
    @CurrentUser() user: Principal,
  ) {
    const voucher = await this.prisma.voucher.findFirstOrThrow({ where: { id } });
    const status = body.status;

    const name = (body.issuedToName ?? '').trim();
    if (status === VoucherStatus.ISSUED && !name && !body.employeeId && !voucher.issuedToName) {
      throw new BadRequestException('Say who the card is being issued to.');
    }

    const employee = body.employeeId
      ? await this.prisma.employee.findFirstOrThrow({ where: { id: body.employeeId } })
      : null;

    const backInDrawer = status === VoucherStatus.AVAILABLE;
    const holderName = employee?.fullName ?? (name || voucher.issuedToName);

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        status,
        issuedToEmployeeId: backInDrawer ? null : (employee?.id ?? voucher.issuedToEmployeeId),
        issuedToName: backInDrawer ? null : holderName,
        issuedByName: status === VoucherStatus.ISSUED ? user.displayName : voucher.issuedByName,
        issuedAt: backInDrawer
          ? null
          : (status === VoucherStatus.ISSUED ? (voucher.issuedAt ?? new Date()) : voucher.issuedAt),
        notes: body.notes ?? voucher.notes,
        updatedById: user.userId,
      },
      include: { issuedTo: { select: { id: true, fullName: true, employeeCode: true } } },
    });

    await this.audit.record({
      action:
        status === VoucherStatus.ISSUED
          ? AuditAction.ALLOCATE
          : backInDrawer
            ? AuditAction.RETURN
            : AuditAction.UPDATE,
      entityType: 'Voucher',
      entityId: id,
      entityLabel: `PVR card ${voucher.voucherNo}`,
      oldValue: { status: voucher.status, issuedToName: voucher.issuedToName },
      newValue: { status: updated.status, issuedToName: updated.issuedToName },
      summary:
        `PVR card ${voucher.voucherNo}: ${voucher.status.toLowerCase()} to ` +
        `${updated.status.toLowerCase()}` +
        (updated.issuedToName ? ` (${updated.issuedToName})` : ''),
    });

    return { ...updated, faceValue: updated.faceValue ? Number(updated.faceValue) : null };
  }

  /** Rename the holder without changing the card's state. */
  @RequirePermissions('asset.update')
  @Post(':id/holder')
  async setHolder(
    @Param('id') id: string,
    @Body() body: { issuedToName: string },
    @CurrentUser() user: Principal,
  ) {
    const voucher = await this.prisma.voucher.findFirstOrThrow({ where: { id } });
    const name = (body.issuedToName ?? '').trim();

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: { issuedToName: name || null, updatedById: user.userId },
      include: { issuedTo: { select: { id: true, fullName: true, employeeCode: true } } },
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Voucher',
      entityId: id,
      entityLabel: `PVR card ${voucher.voucherNo}`,
      oldValue: { issuedToName: voucher.issuedToName },
      newValue: { issuedToName: updated.issuedToName },
      summary: `PVR card ${voucher.voucherNo} holder set to ${updated.issuedToName ?? 'nobody'}`,
    });

    return { ...updated, faceValue: updated.faceValue ? Number(updated.faceValue) : null };
  }

}

@Module({ controllers: [VouchersController] })
export class VouchersModule {}
