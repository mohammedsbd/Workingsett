import { Module } from '@nestjs/common';
import { ArchivedItemRepository } from '../archived-item.repository';
import { ArchivedItemRelationalRepository } from './repositories/archived-item.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArchivedItemEntity } from './entities/archived-item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ArchivedItemEntity])],
  providers: [
    {
      provide: ArchivedItemRepository,
      useClass: ArchivedItemRelationalRepository,
    },
  ],
  exports: [ArchivedItemRepository],
})
export class RelationalArchivedItemPersistenceModule {}
