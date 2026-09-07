import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { ExportService } from './export.service';
import { BackupController } from './backup.controller';
import { BackupScheduler } from './backup.scheduler';
import { MongoMirrorScheduler } from './mongo-mirror.scheduler';

@Module({
  providers: [BackupService, ExportService, BackupScheduler, MongoMirrorScheduler],
  controllers: [BackupController],
  exports: [BackupService, ExportService],
})
export class BackupModule {}
