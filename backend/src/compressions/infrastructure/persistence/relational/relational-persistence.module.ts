import { Module } from '@nestjs/common';
import { CompressionRepository } from '../compression.repository';
import { CompressionRelationalRepository } from './repositories/compression.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompressionEntity } from './entities/compression.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CompressionEntity])],
  providers: [
    {
      provide: CompressionRepository,
      useClass: CompressionRelationalRepository,
    },
  ],
  exports: [CompressionRepository],
})
export class RelationalCompressionPersistenceModule {}
