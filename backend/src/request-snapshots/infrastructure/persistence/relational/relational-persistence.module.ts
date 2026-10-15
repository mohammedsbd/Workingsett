import { Module } from '@nestjs/common';
import { RequestSnapshotRepository } from '../request-snapshot.repository';
import { RequestSnapshotRelationalRepository } from './repositories/request-snapshot.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestSnapshotEntity } from './entities/request-snapshot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RequestSnapshotEntity])],
  providers: [
    {
      provide: RequestSnapshotRepository,
      useClass: RequestSnapshotRelationalRepository,
    },
  ],
  exports: [RequestSnapshotRepository],
})
export class RelationalRequestSnapshotPersistenceModule {}
