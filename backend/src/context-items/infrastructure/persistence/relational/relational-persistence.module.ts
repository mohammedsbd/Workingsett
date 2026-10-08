import { Module } from '@nestjs/common';
import { ContextItemRepository } from '../context-item.repository';
import { ContextItemRelationalRepository } from './repositories/context-item.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContextItemEntity } from './entities/context-item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContextItemEntity])],
  providers: [
    {
      provide: ContextItemRepository,
      useClass: ContextItemRelationalRepository,
    },
  ],
  exports: [ContextItemRepository],
})
export class RelationalContextItemPersistenceModule {}
