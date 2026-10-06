import { Module } from '@nestjs/common';
import { RelationalProjectPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [RelationalProjectPersistenceModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
