import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { configuration } from './config/configuration';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SyncModule } from './modules/sync/sync.module';
import { BackupModule } from './modules/backup/backup.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AllocationsModule } from './modules/allocations/allocations.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { CugModule } from './modules/cug/cug.module';
import { LockersModule } from './modules/lockers/lockers.module';
import { RepairsModule } from './modules/repairs/repairs.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
      // One .env at the repo root serves the whole workspace. The API's cwd is
      // apps/api, so the root file is two levels up; the local paths are
      // fallbacks for a container where the app is deployed on its own.
      envFilePath: ['../../.env', '../.env', '.env'],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL ?? 60) * 1000,
        limit: Number(process.env.RATE_LIMIT_MAX ?? 300),
      },
    ]),

    PrismaModule,
    AuditModule,
    RealtimeModule,

    AuthModule,
    EmployeesModule,
    AssetsModule,
    AllocationsModule,
    SyncModule,
    CugModule,
    LockersModule,
    RepairsModule,
    BackupModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    // Order matters: context is opened first, then auth, then authorisation.
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
