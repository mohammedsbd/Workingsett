import { Module } from '@nestjs/common';
import { ContextContentRepository } from '../context-content.repository';
import { ContextContentRelationalRepository } from './repositories/context-content.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContextContentEntity } from './entities/context-content.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContextContentEntity])],
  providers: [
    {
      provide: ContextContentRepository,
      useClass: ContextContentRelationalRepository,
    },
  ],
  exports: [ContextContentRepository],
})
export class RelationalContextContentPersistenceModule {}
