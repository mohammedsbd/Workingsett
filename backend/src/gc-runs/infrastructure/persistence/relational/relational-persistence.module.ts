import { Module } from '@nestjs/common';
import { GcRunRepository } from '../gc-run.repository';
import { GcRunRelationalRepository } from './repositories/gc-run.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GcRunEntity } from './entities/gc-run.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GcRunEntity])],
  providers: [
    {
      provide: GcRunRepository,
      useClass: GcRunRelationalRepository,
    },
  ],
  exports: [GcRunRepository],
})
export class RelationalGcRunPersistenceModule {}
