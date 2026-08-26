import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applySoftDeleteExtension } from './soft-delete.extension';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
        ...(process.env.PRISMA_LOG_QUERIES === 'true'
          ? ([{ emit: 'event', level: 'query' }] as const)
          : []),
      ],
      errorFormat: 'pretty',
    });
  }

  async onModuleInit(): Promise<void> {
    // Nest calls lifecycle hooks on every provider, and the PRISMA provider is
    // a Proxy that $extends built over *this* instance - so this hook fires
    // twice. An extended client deliberately does not expose $on, $connect or
    // $disconnect, so the second call must be a no-op rather than a crash.
    if (typeof (this as { $on?: unknown }).$on !== 'function') return;

    (this as any).$on('warn', (e: { message: string }) =>
      this.logger.warn(e.message),
    );
    (this as any).$on('error', (e: { message: string }) =>
      this.logger.error(e.message),
    );

    await this.$connect();
    this.logger.log('Connected to PostgreSQL (master data store)');
  }

  async onModuleDestroy(): Promise<void> {
    // Same reason as onModuleInit: only the real client can disconnect.
    if (typeof (this as { $disconnect?: unknown }).$disconnect !== 'function') return;
    await this.$disconnect();
  }

  /** Nest closes the Prisma connection cleanly on SIGTERM. */
  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /**
   * Row counts per table, used by the backup module as a cheap integrity
   * signal: if a count drops between two consecutive backups, something
   * deleted data and somebody needs to know today, not next quarter.
   */
  async tableCounts(): Promise<Record<string, number>> {
    const rows = await this.$queryRaw<Array<{ table_name: string; n: bigint }>>`
      SELECT relname AS table_name, n_live_tup AS n
      FROM pg_stat_user_tables
      ORDER BY relname
    `;
    return Object.fromEntries(rows.map((r) => [r.table_name, Number(r.n)]));
  }
}

/**
 * The client every service should inject. Hard deletes are refused, archived
 * rows are filtered out, and history tables are immutable.
 */
export const PRISMA = Symbol('PRISMA_EXTENDED_CLIENT');

export type ExtendedPrisma = PrismaService;

export const prismaProvider = {
  provide: PRISMA,
  inject: [PrismaService],
  useFactory: (base: PrismaService): ExtendedPrisma =>
    applySoftDeleteExtension(base),
};
