import { Module } from '@nestjs/common';
import { CashflowsController } from './cashflows.controller';
import { CashflowsService } from './cashflows.service';

@Module({
  controllers: [CashflowsController],
  providers: [CashflowsService],
  exports: [CashflowsService],
})
export class CashflowsModule {}
