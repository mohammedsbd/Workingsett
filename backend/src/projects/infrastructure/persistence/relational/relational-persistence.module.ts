import { Module } from '@nestjs/common';
import { ProjectRepository } from '../project.repository';
import { ProjectRelationalRepository } from './repositories/project.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from './entities/project.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity])],
  providers: [
    {
      provide: ProjectRepository,
      useClass: ProjectRelationalRepository,
    },
  ],
  exports: [ProjectRepository],
})
export class RelationalProjectPersistenceModule {}
