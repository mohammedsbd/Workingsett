import { Module } from '@nestjs/common';
import { ParsimApiKeyRepository } from '../parsim-api-key.repository';
import { ParsimApiKeyRelationalRepository } from './repositories/parsim-api-key.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParsimApiKeyEntity } from './entities/parsim-api-key.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ParsimApiKeyEntity])],
  providers: [
    {
      provide: ParsimApiKeyRepository,
      useClass: ParsimApiKeyRelationalRepository,
    },
  ],
  exports: [ParsimApiKeyRepository],
})
export class RelationalParsimApiKeyPersistenceModule {}
