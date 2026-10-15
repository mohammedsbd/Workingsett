import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProxyModule } from '../proxy/proxy.module';
import { RelationalReplayResultPersistenceModule } from '../replay-results/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalReplayPersistenceModule } from '../replays/infrastructure/persistence/relational/relational-persistence.module';
import { RequestSnapshotsModule } from '../request-snapshots/request-snapshots.module';
import { UsageRecordsModule } from '../usage-records/usage-records.module';
import { ReplayController } from './replay.controller';
import { ReplayService } from './replay.service';

/** Replays of recorded sessions, run as pg-boss jobs (see docs/replay.md). */
@Module({
  imports: [
    JobsModule,
    ProjectsModule,
    ProxyModule,
    RequestSnapshotsModule,
    UsageRecordsModule,
    RelationalReplayPersistenceModule,
    RelationalReplayResultPersistenceModule,
  ],
  controllers: [ReplayController],
  providers: [ReplayService],
})
export class ReplayModule {}
