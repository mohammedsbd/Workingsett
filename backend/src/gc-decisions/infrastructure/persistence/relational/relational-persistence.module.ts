import { Module } from '@nestjs/common';
import { GcDecisionRepository } from '../gc-decision.repository';
import { GcDecisionRelationalRepository } from './repositories/gc-decision.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GcDecisionEntity } from './entities/gc-decision.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GcDecisionEntity])],
  providers: [
    {
      provide: GcDecisionRepository,
      useClass: GcDecisionRelationalRepository,
    },
  ],
  exports: [GcDecisionRepository],
})
export class RelationalGcDecisionPersistenceModule {}
