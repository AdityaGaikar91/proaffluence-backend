import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './guards/auth.guard';
import { MeController } from './me.controller';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

@Module({
  controllers: [PasswordResetController, MeController],
  providers: [
    PasswordResetService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [PasswordResetService],
})
export class AuthModule {}
