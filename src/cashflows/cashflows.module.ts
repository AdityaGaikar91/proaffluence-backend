import { Module, forwardRef } from '@nestjs/common';
import { CashflowsController } from './cashflows.controller';
import { CashflowsService } from './cashflows.service';
import { CashflowMathService } from './cashflow-math.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [forwardRef(() => JobsModule)],
  controllers: [CashflowsController],
  providers: [CashflowsService, CashflowMathService],
  exports: [CashflowsService, CashflowMathService],
})
export class CashflowsModule {}
