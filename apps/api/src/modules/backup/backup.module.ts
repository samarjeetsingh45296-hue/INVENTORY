import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { ExportService } from './export.service';
import { BackupController } from './backup.controller';
import { BackupScheduler } from './backup.scheduler';

@Module({
  providers: [BackupService, ExportService, BackupScheduler],
  controllers: [BackupController],
  exports: [BackupService, ExportService],
})
export class BackupModule {}
