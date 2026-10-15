import { Module } from '@nestjs/common';
import { ReplayRepository } from '../replay.repository';
import { ReplayRelationalRepository } from './repositories/replay.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReplayEntity } from './entities/replay.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ReplayEntity])],
  providers: [
    {
      provide: ReplayRepository,
      useClass: ReplayRelationalRepository,
    },
  ],
  exports: [ReplayRepository],
})
export class RelationalReplayPersistenceModule {}
