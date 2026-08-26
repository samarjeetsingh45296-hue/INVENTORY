import { Global, Module } from '@nestjs/common';
import { PrismaService, prismaProvider, PRISMA } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, prismaProvider],
  exports: [PrismaService, PRISMA],
})
export class PrismaModule {}
