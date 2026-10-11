import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { UsageRecordsModule } from '../usage-records/usage-records.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Read-only endpoints for the Parsim dashboard. */
@Module({
  imports: [ProjectsModule, UsageRecordsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
