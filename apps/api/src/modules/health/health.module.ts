import { Controller, Get, Inject, Module } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';

@Controller('health')
class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrisma) {}

  /** Liveness: is the process up. */
  @Public()
  @Get()
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: can we actually serve traffic (database reachable). */
  @Public()
  @Get('ready')
  async ready() {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'up', latencyMs: Date.now() - started };
    } catch (err) {
      return {
        status: 'degraded',
        database: 'down',
        error: (err as Error).message,
      };
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
