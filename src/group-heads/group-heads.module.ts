import { Module } from '@nestjs/common';
import { GroupHeadsController } from './group-heads.controller';
import { GroupHeadsService } from './group-heads.service';
import { PrismaModule } from '../core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [GroupHeadsController],
  providers: [GroupHeadsService],
  exports: [GroupHeadsService],
})
export class GroupHeadsModule {}
