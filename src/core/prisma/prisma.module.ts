import { Global, Module } from '@nestjs/common';
import { PrismaService, prisma } from './prisma.service';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useValue: prisma,
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
