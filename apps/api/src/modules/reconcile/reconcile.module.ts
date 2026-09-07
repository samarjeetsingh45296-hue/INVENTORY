import { Module } from '@nestjs/common';
import { GoogleSheetsAdapter } from '../sync/adapters/google-sheets.adapter';
import { ReconcileService } from './reconcile.service';
import { ReconcileScheduler } from './reconcile.scheduler';
import { ReconcileController } from './reconcile.controller';

@Module({
  providers: [ReconcileService, ReconcileScheduler, GoogleSheetsAdapter],
  controllers: [ReconcileController],
  exports: [ReconcileService],
})
export class ReconcileModule {}
