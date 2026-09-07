import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReconcileService } from './reconcile.service';

@ApiTags('reconcile')
@Controller('reconcile')
export class ReconcileController {
  constructor(
    private readonly reconcile: ReconcileService,
    private readonly prisma: PrismaService,
  ) {}

  /** The dashboard: latest run with its exceptions, recent runs, sync times. */
  @RequirePermissions('sync.read')
  @Get('latest')
  latest() {
    return this.reconcile.latest();
  }

  @RequirePermissions('sync.read')
  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.prisma.reconciliationRun.findFirst({ where: { id } });
  }

  /** Validate now. Waits for the pass to finish and returns its id. */
  @RequirePermissions('sync.run')
  @Post('run')
  runNow() {
    return this.reconcile.run('manual');
  }
}
