import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { SyncSchedule } from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { RequirePermissions, CurrentUser } from '../../common/decorators';
import { SyncEngine } from './sync.engine';
import { SyncService } from './sync.service';
import type { Principal } from '@inventory/shared';

@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrisma,
    private readonly engine: SyncEngine,
    private readonly sync: SyncService,
  ) {}

  // ----------------------------------------------------------- sources ----

  @RequirePermissions('sync.read')
  @Get('sources')
  listSources() {
    return this.prisma.syncSource.findMany({
      include: { mappings: true, _count: { select: { runs: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @RequirePermissions('sync.configure')
  @Post('sources')
  createSource(@Body() body: Record<string, unknown>) {
    return this.sync.createSource(body);
  }

  @RequirePermissions('sync.configure')
  @Patch('sources/:id')
  updateSource(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.sync.updateSource(id, body);
  }

  /**
   * Reads only the header row so the admin can map columns before importing
   * anything. Nothing is written by this call.
   */
  @RequirePermissions('sync.configure')
  @Get('sources/:id/columns')
  previewColumns(@Param('id') id: string) {
    return this.sync.previewColumns(id);
  }

  @RequirePermissions('sync.configure')
  @Post('sources/:id/mappings')
  setMappings(
    @Param('id') id: string,
    @Body() body: { mappings: Array<Record<string, unknown>> },
  ) {
    return this.sync.replaceMappings(id, body.mappings);
  }

  /** Suggests a column mapping by matching headers against entity fields. */
  @RequirePermissions('sync.configure')
  @Post('sources/:id/mappings/suggest')
  suggestMappings(@Param('id') id: string) {
    return this.sync.suggestMappings(id);
  }

  // -------------------------------------------------------------- runs ----

  /** Option 1: manual sync. Imports new rows and safe updates. */
  @RequirePermissions('sync.run')
  @Post('sources/:id/run')
  run(
    @Param('id') id: string,
    @Body() body: { dryRun?: boolean; confirmationToken?: string },
  ) {
    return this.engine.run({
      sourceId: id,
      dryRun: body.dryRun ?? false,
      confirmationToken: body.confirmationToken,
    });
  }

  /** Dry run: shows exactly what would change, writes nothing. */
  @RequirePermissions('sync.read')
  @Post('sources/:id/preview')
  preview(@Param('id') id: string) {
    return this.engine.run({ sourceId: id, dryRun: true });
  }

  /**
   * Option 3: one-time migration. Imports once, takes a backup first, then
   * disconnects the sheet permanently.
   */
  @RequirePermissions('sync.migrate')
  @Post('sources/:id/migrate')
  migrate(@Param('id') id: string, @CurrentUser() user: Principal) {
    return this.sync.oneTimeMigration(id, user);
  }

  /** Cuts the link to a sheet without deleting a single imported record. */
  @RequirePermissions('sync.migrate')
  @Post('sources/:id/disconnect')
  disconnect(@Param('id') id: string, @CurrentUser() user: Principal) {
    return this.sync.disconnect(id, user);
  }

  @RequirePermissions('sync.configure')
  @Post('sources/:id/reconnect')
  reconnect(@Param('id') id: string) {
    return this.sync.reconnect(id);
  }

  /** Option 2: scheduled sync - OFF | HOURLY | SIX_HOURLY | DAILY. */
  @RequirePermissions('sync.configure')
  @Patch('sources/:id/schedule')
  setSchedule(@Param('id') id: string, @Body() body: { schedule: SyncSchedule }) {
    return this.sync.setSchedule(id, body.schedule);
  }

  @RequirePermissions('sync.read')
  @Get('runs')
  listRuns(@Query('sourceId') sourceId?: string, @Query('take') take = '25') {
    return this.prisma.syncRun.findMany({
      where: sourceId ? { sourceId } : {},
      orderBy: { startedAt: 'desc' },
      take: Math.min(Number(take) || 25, 100),
      include: { source: { select: { name: true, targetEntity: true } } },
    });
  }

  /** The row-by-row report: what was imported, skipped, and why. */
  @RequirePermissions('sync.read')
  @Get('runs/:runId/rows')
  async runRows(
    @Param('runId') runId: string,
    @Query('status') status?: string,
    @Query('take') take = '200',
  ) {
    const rows = await this.prisma.syncRow.findMany({
      where: { runId, ...(status ? { status: status as never } : {}) },
      orderBy: { rowNumber: 'asc' },
      take: Math.min(Number(take) || 200, 1000),
    });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }

  // ------------------------------------------------------------ upload ----

  /**
   * The no-Google-account path: upload the downloaded .xlsx or .csv directly.
   */
  @RequirePermissions('sync.upload')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: { path: string; originalname: string },
    @Body() body: { sourceId?: string; targetEntity?: string; dryRun?: string },
  ) {
    const sourceId = await this.sync.ensureUploadSource(
      body.sourceId,
      body.targetEntity ?? 'employee',
      file.originalname,
    );
    return this.engine.run({
      sourceId,
      dryRun: body.dryRun === 'true',
      filePath: file.path,
    });
  }
}
