import { Module } from '@nestjs/common';
import { RecallRepository } from '../recall.repository';
import { RecallRelationalRepository } from './repositories/recall.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecallEntity } from './entities/recall.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RecallEntity])],
  providers: [
    {
      provide: RecallRepository,
      useClass: RecallRelationalRepository,
    },
  ],
  exports: [RecallRepository],
})
export class RelationalRecallPersistenceModule {}
