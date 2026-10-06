import { Module } from '@nestjs/common';
import { RelationalUsageRecordPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ModelPricingService } from './pricing/model-pricing.service';
import { UsageRecordsService } from './usage-records.service';

@Module({
  imports: [RelationalUsageRecordPersistenceModule],
  providers: [UsageRecordsService, ModelPricingService],
  exports: [UsageRecordsService, ModelPricingService],
})
export class UsageRecordsModule {}
