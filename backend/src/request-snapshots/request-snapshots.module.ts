import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RelationalSnapshotPartPersistenceModule } from '../snapshot-parts/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalRequestSnapshotPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { RequestSnapshotsService } from './request-snapshots.service';

@Module({
  imports: [
    ProjectsModule,
    RelationalRequestSnapshotPersistenceModule,
    RelationalSnapshotPartPersistenceModule,
  ],
  providers: [RequestSnapshotsService],
  exports: [RequestSnapshotsService],
})
export class RequestSnapshotsModule {}
