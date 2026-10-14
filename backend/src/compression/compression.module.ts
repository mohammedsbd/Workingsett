import { Module } from '@nestjs/common';
import { RelationalArchivedItemPersistenceModule } from '../archived-items/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalCompressionPersistenceModule } from '../compressions/infrastructure/persistence/relational/relational-persistence.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsageRecordsModule } from '../usage-records/usage-records.module';
import { CompressionService } from './compression.service';

@Module({
  imports: [
    JobsModule,
    ProjectsModule,
    UsageRecordsModule,
    RelationalCompressionPersistenceModule,
    RelationalArchivedItemPersistenceModule,
  ],
  providers: [CompressionService],
  exports: [CompressionService],
})
export class CompressionModule {}
