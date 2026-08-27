import { Body, Controller, Get, Inject, Module, Param, Post, Query } from '@nestjs/common';
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
    @Query('pageSize') pageSize = '50',
    @Query('search') search?: string,
    @Query('status') status?: VoucherStatus,
  ) {
    const take = Math.min(Number(pageSize) || 50, 200);
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

    const [items, total, byStatus, byBook] = await Promise.all([
      this.prisma.voucher.findMany({
        where,
        include: {
          issuedTo: { select: { id: true, fullName: true, employeeCode: true } },
        },
        orderBy: [{ voucherNo: 'asc' }, { serialNo: 'asc' }],
        take,
        skip: ((Number(page) || 1) - 1) * take,
      }),
      this.prisma.voucher.count({ where }),
      this.prisma.voucher.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.voucher.groupBy({
        by: ['voucherNo'],
        _count: { _all: true },
        orderBy: { voucherNo: 'asc' },
      }),
    ]);

    // How many cards remain in each book - the question the store actually asks.
    const remaining = await this.prisma.voucher.groupBy({
      by: ['voucherNo'],
      where: { status: VoucherStatus.AVAILABLE },
      _count: { _all: true },
    });

    return {
      items: items.map((v) => ({
        ...v,
        faceValue: v.faceValue ? Number(v.faceValue) : null,
      })),
      summary: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        books: byBook.map((b) => ({
          voucherNo: b.voucherNo,
          total: b._count._all,
          available:
            remaining.find((r) => r.voucherNo === b.voucherNo)?._count._all ?? 0,
        })),
      },
      page: Number(page) || 1,
      pageSize: take,
      total,
      totalPages: Math.ceil(total / take),
    };
  }
  /** Issue a card to someone. */
  @RequirePermissions('asset.update')
  @Post(':id/issue')
  async issue(
    @Param('id') id: string,
    @Body() body: { employeeId?: string; issuedToName?: string; purpose?: string },
    @CurrentUser() user: Principal,
  ) {
    const voucher = await this.prisma.voucher.findFirstOrThrow({ where: { id } });
    if (voucher.status !== VoucherStatus.AVAILABLE) {
      throw new Error(
        `Card ${voucher.voucherNo} is already ${voucher.status.toLowerCase()}.`,
      );
    }

    const employee = body.employeeId
      ? await this.prisma.employee.findFirstOrThrow({ where: { id: body.employeeId } })
      : null;

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        status: VoucherStatus.ISSUED,
        issuedToEmployeeId: employee?.id ?? null,
        issuedToName: employee?.fullName ?? body.issuedToName ?? null,
        issuedByName: user.displayName,
        issuedAt: new Date(),
        purpose: body.purpose ?? voucher.purpose,
        updatedById: user.userId,
      },
    });

    await this.audit.record({
      action: AuditAction.ALLOCATE,
      entityType: 'Voucher',
      entityId: id,
      entityLabel: `PVR card ${voucher.voucherNo}`,
      oldValue: { status: voucher.status, issuedToName: voucher.issuedToName },
      newValue: { status: updated.status, issuedToName: updated.issuedToName },
      summary: `PVR card ${voucher.voucherNo} issued to ${updated.issuedToName ?? 'someone'}`,
    });
    return { ...updated, faceValue: updated.faceValue ? Number(updated.faceValue) : null };
  }

  /**
   * Put a card back in the drawer. The previous holder stays on the audit
   * trail; only the current state is cleared.
   */
  @RequirePermissions('asset.update')
  @Post(':id/return')
  async unissue(@Param('id') id: string, @CurrentUser() user: Principal) {
    const voucher = await this.prisma.voucher.findFirstOrThrow({ where: { id } });

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        status: VoucherStatus.AVAILABLE,
        issuedToEmployeeId: null,
        issuedToName: null,
        issuedAt: null,
        updatedById: user.userId,
      },
    });

    await this.audit.record({
      action: AuditAction.RETURN,
      entityType: 'Voucher',
      entityId: id,
      entityLabel: `PVR card ${voucher.voucherNo}`,
      oldValue: { status: voucher.status, issuedToName: voucher.issuedToName },
      newValue: { status: updated.status, issuedToName: null },
      summary: `PVR card ${voucher.voucherNo} returned by ${voucher.issuedToName ?? 'holder'}`,
    });
    return { ...updated, faceValue: updated.faceValue ? Number(updated.faceValue) : null };
  }

  /** Mark a card used, lost or void without it going back into stock. */
  @RequirePermissions('asset.update')
  @Post(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body() body: { status: VoucherStatus; notes?: string },
    @CurrentUser() user: Principal,
  ) {
    const voucher = await this.prisma.voucher.findFirstOrThrow({ where: { id } });
    const updated = await this.prisma.voucher.update({
      where: { id },
      data: { status: body.status, notes: body.notes ?? voucher.notes, updatedById: user.userId },
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Voucher',
      entityId: id,
      entityLabel: `PVR card ${voucher.voucherNo}`,
      oldValue: { status: voucher.status },
      newValue: { status: updated.status },
      summary: `PVR card ${voucher.voucherNo}: ${voucher.status} to ${updated.status}`,
    });
    return { ...updated, faceValue: updated.faceValue ? Number(updated.faceValue) : null };
  }
}

@Module({ controllers: [VouchersController] })
export class VouchersModule {}
