import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import { RequirePermissions } from '../../common/decorators';
import { BackupService } from './backup.service';
import { ExportService } from './export.service';

@ApiTags('backup')
@Controller('backup')
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly exporter: ExportService,
  ) {}

  @RequirePermissions('backup.read')
  @Get()
  list(@Query('take') take = '50') {
    return this.backup.list(Math.min(Number(take) || 50, 200));
  }

  @RequirePermissions('backup.read')
  @Get('integrity')
  integrity() {
    return this.backup.verifyIntegrity();
  }

  /** Manual database backup. */
  @RequirePermissions('backup.create')
  @Post('database')
  createDatabaseBackup(@Body() body: { reason?: string }) {
    return this.backup.createBackup({ type: 'MANUAL', reason: body.reason });
  }

  @RequirePermissions('backup.read')
  @Get('datasets')
  datasets() {
    return { datasets: this.exporter.listDatasets() };
  }

  /** Manual Excel backup: one workbook, one sheet per dataset. */
  @RequirePermissions('backup.create')
  @Post('excel')
  async excel(@Res({ passthrough: false }) res: any) {
    const { filePath, fileName } = await this.exporter.exportWorkbook();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    createReadStream(filePath).pipe(res);
  }

  /** Manual CSV backup for a single dataset. */
  @RequirePermissions('backup.create')
  @Get('csv/:dataset')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(@Param('dataset') dataset: string, @Res({ passthrough: true }) res: any) {
    const { fileName, content } = await this.exporter.exportCsv(dataset);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return content;
  }
}
