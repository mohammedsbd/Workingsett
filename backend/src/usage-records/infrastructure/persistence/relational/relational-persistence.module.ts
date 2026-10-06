import { Module } from '@nestjs/common';
import { UsageRecordRepository } from '../usage-record.repository';
import { UsageRecordRelationalRepository } from './repositories/usage-record.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageRecordEntity } from './entities/usage-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UsageRecordEntity])],
  providers: [
    {
      provide: UsageRecordRepository,
      useClass: UsageRecordRelationalRepository,
    },
  ],
  exports: [UsageRecordRepository],
})
export class RelationalUsageRecordPersistenceModule {}
