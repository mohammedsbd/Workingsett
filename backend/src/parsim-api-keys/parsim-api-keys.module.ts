import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RelationalParsimApiKeyPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ParsimApiKeysController } from './parsim-api-keys.controller';
import { ParsimApiKeysService } from './parsim-api-keys.service';

@Module({
  imports: [ProjectsModule, RelationalParsimApiKeyPersistenceModule],
  controllers: [ParsimApiKeysController],
  providers: [ParsimApiKeysService],
  exports: [ParsimApiKeysService],
})
export class ParsimApiKeysModule {}
