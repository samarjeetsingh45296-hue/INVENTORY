import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SyncEngine } from './sync.engine';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SyncScheduler } from './sync.scheduler';
import { GoogleSheetsAdapter } from './adapters/google-sheets.adapter';
import { FileAdapter } from './adapters/file.adapter';
import { EmployeeWriter } from './writers/employee.writer';
import { AssetWriter } from './writers/asset.writer';
import { BackupModule } from '../backup/backup.module';

const ALLOWED_UPLOAD_EXT = new Set(['.xlsx', '.xls', '.csv', '.tsv']);

@Module({
  imports: [
    BackupModule,
    MulterModule.register({
      storage: diskStorage({
        destination: process.env.STORAGE_LOCAL_DIR ?? './uploads',
        filename: (_req, file, cb) =>
          cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        cb(
          ALLOWED_UPLOAD_EXT.has(ext)
            ? null
            : new Error(`Only ${[...ALLOWED_UPLOAD_EXT].join(', ')} files can be imported`),
          ALLOWED_UPLOAD_EXT.has(ext),
        );
      },
    }),
  ],
  providers: [
    SyncEngine,
    SyncService,
    SyncScheduler,
    GoogleSheetsAdapter,
    FileAdapter,
    EmployeeWriter,
    AssetWriter,
  ],
  controllers: [SyncController],
  exports: [SyncEngine, SyncService],
})
export class SyncModule {}
