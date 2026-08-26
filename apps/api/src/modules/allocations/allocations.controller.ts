import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllocationStatus } from '@prisma/client';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { AllocationsService } from './allocations.service';
import type { Principal } from '@inventory/shared';

@ApiTags('allocations')
@Controller('allocations')
export class AllocationsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly allocations: AllocationsService,
  ) {}

  @RequirePermissions('allocation.read')
  @Get()
  list(
    @Query('status') status?: AllocationStatus,
    @Query('employeeId') employeeId?: string,
    @Query('assetId') assetId?: string,
    @Query('take') take = '50',
  ) {
    return this.prisma.assetAllocation.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(employeeId ? { employeeId } : {}),
        ...(assetId ? { assetId } : {}),
      },
      include: {
        asset: { include: { category: true } },
        employee: { select: { fullName: true, employeeCode: true } },
      },
      orderBy: { allocatedAt: 'desc' },
      take: Math.min(Number(take) || 50, 200),
    });
  }

  @RequirePermissions('allocation.allocate')
  @Post()
  allocate(@Body() body: any, @CurrentUser() principal: Principal) {
    return this.allocations.allocate(body, principal);
  }

  @RequirePermissions('allocation.return')
  @Post('return')
  returnAsset(@Body() body: any, @CurrentUser() principal: Principal) {
    return this.allocations.returnAsset(body, principal);
  }

  @RequirePermissions('allocation.transfer')
  @Post('transfer')
  transfer(@Body() body: any, @CurrentUser() principal: Principal) {
    return this.allocations.transfer(body, principal);
  }

  /** Full lifetime custody chain plus timeline for one asset. */
  @RequirePermissions('allocation.read')
  @Get('asset/:assetId/history')
  history(@Param('assetId') assetId: string) {
    return this.allocations.historyForAsset(assetId);
  }
}
