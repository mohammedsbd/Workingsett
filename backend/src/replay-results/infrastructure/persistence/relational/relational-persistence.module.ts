import { Module } from '@nestjs/common';
import { ReplayResultRepository } from '../replay-result.repository';
import { ReplayResultRelationalRepository } from './repositories/replay-result.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReplayResultEntity } from './entities/replay-result.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ReplayResultEntity])],
  providers: [
    {
      provide: ReplayResultRepository,
      useClass: ReplayResultRelationalRepository,
    },
  ],
  exports: [ReplayResultRepository],
})
export class RelationalReplayResultPersistenceModule {}
