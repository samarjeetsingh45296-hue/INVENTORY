import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AssetStatus, Prisma } from '@prisma/client';
import { CurrentUser, RequireAny, RequirePermissions } from '../../common/decorators';
import { AssetsService } from './assets.service';
import type { Principal } from '@inventory/shared';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /**
   * Any of the three read permissions can reach this route; the service then
   * narrows the result set to what that role is actually allowed to see.
   */
  @RequirePermissions('asset.read', 'asset.read_team', 'asset.read_own')
  @RequireAny()
  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: AssetStatus,
    @Query('branchId') branchId?: string,
    @Query('locationId') locationId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.assets.list({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
      search,
      categoryId,
      status,
      branchId,
      locationId,
      includeArchived: includeArchived === 'true',
      principal,
    });
  }

  /**
   * Declared before :id on purpose - Nest matches routes in order, so a
   * ':id' above this would capture the literal string "categories".
   */
  @RequirePermissions('asset.read', 'asset.read_team', 'asset.read_own')
  @RequireAny()
  @Get('categories')
  listCategories() {
    return this.assets.listCategories();
  }

  @RequirePermissions('asset.read', 'asset.read_team', 'asset.read_own')
  @RequireAny()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assets.findOne(id);
  }

  @RequirePermissions('asset.create')
  @Post()
  create(
    @Body() body: Prisma.AssetUncheckedCreateInput,
    @CurrentUser() principal: Principal,
  ) {
    return this.assets.create(body, principal);
  }

  @RequirePermissions('asset.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: Prisma.AssetUncheckedUpdateInput,
    @CurrentUser() principal: Principal,
  ) {
    return this.assets.update(id, body, principal);
  }

  /**
   * Raises an approval request. There is no endpoint anywhere in this API that
   * deletes an asset outright.
   */
  @RequirePermissions('asset.delete')
  @Post(':id/archive-request')
  requestArchive(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() principal: Principal,
  ) {
    return this.assets.requestArchive(id, body.reason ?? 'No reason given', principal);
  }

  @RequirePermissions('asset.restore')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() principal: Principal) {
    return this.assets.restore(id, principal);
  }
}
