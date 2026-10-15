import { Module } from '@nestjs/common';
import { SnapshotPartRepository } from '../snapshot-part.repository';
import { SnapshotPartRelationalRepository } from './repositories/snapshot-part.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnapshotPartEntity } from './entities/snapshot-part.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SnapshotPartEntity])],
  providers: [
    {
      provide: SnapshotPartRepository,
      useClass: SnapshotPartRelationalRepository,
    },
  ],
  exports: [SnapshotPartRepository],
})
export class RelationalSnapshotPartPersistenceModule {}
