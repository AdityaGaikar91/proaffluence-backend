import { Module } from '@nestjs/common';
import { ClosingBalancesService } from './closing-balances.service';
import { ClosingBalancesController } from './closing-balances.controller';
import { PrismaModule } from '../core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ClosingBalancesController],
  providers: [ClosingBalancesService],
  exports: [ClosingBalancesService],
})
export class ClosingBalancesModule {}
