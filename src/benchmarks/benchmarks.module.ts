import { Module } from '@nestjs/common';
import { PrismaModule } from '../core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BenchmarksController } from './benchmarks.controller';
import { BenchmarksService } from './benchmarks.service';
import { INDEX_FEED_PROVIDERS } from './providers/index-feed.types';
import { NseArchivesProvider } from './providers/nse-archives.provider';
import {
  BseIndiaProvider,
  NiftyIndicesTriProvider,
} from './providers/unavailable.providers';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [BenchmarksController],
  providers: [
    BenchmarksService,
    {
      provide: INDEX_FEED_PROVIDERS,
      useFactory: () => [
        new NiftyIndicesTriProvider(),
        new NseArchivesProvider(),
        new BseIndiaProvider(),
      ],
    },
  ],
  exports: [BenchmarksService],
})
export class BenchmarksModule {}
