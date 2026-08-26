import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { EmployeesService } from './employees.service';
import type { Principal } from '@inventory/shared';

@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermissions('employee.read')
  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.employees.list({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
      search,
      branchId,
      departmentId,
      status,
      includeArchived: includeArchived === 'true',
      principal,
    });
  }

  @RequirePermissions('employee.read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employees.findOne(id);
  }

  /** Every asset this person has ever held, returned items included. */
  @RequirePermissions('employee.read')
  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.employees.history(id);
  }

  @RequirePermissions('employee.create')
  @Post()
  create(
    @Body() body: Prisma.EmployeeUncheckedCreateInput,
    @CurrentUser() principal: Principal,
  ) {
    return this.employees.create(body, principal);
  }

  @RequirePermissions('employee.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: Prisma.EmployeeUncheckedUpdateInput,
    @CurrentUser() principal: Principal,
  ) {
    return this.employees.update(id, body, principal);
  }

  /**
   * Archives the record. There is no hard-delete endpoint: history is kept
   * whatever happens.
   */
  @RequirePermissions('employee.delete')
  @Post(':id/archive')
  archive(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() principal: Principal,
  ) {
    return this.employees.archive(id, body.reason ?? 'No reason given', principal);
  }

  @RequirePermissions('employee.restore')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() principal: Principal) {
    return this.employees.restore(id, principal);
  }
}
