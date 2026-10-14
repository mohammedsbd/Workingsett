import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Compression } from '../../../../domain/compression';
import {
  CompressionRepository,
  NewCompression,
} from '../../compression.repository';
import { CompressionEntity } from '../entities/compression.entity';
import { CompressionMapper } from '../mappers/compression.mapper';

@Injectable()
export class CompressionRelationalRepository implements CompressionRepository {
  constructor(
    @InjectRepository(CompressionEntity)
    private readonly repository: Repository<CompressionEntity>,
  ) {}

  async createPending(
    compression: NewCompression,
  ): Promise<NullableType<Compression>> {
    const result = await this.repository
      .createQueryBuilder()
      .insert()
      // TypeORM's deep-partial type cannot describe an arbitrary jsonb value.
      .values({
        ...compression,
        status: 'pending',
      } as unknown as QueryDeepPartialEntity<CompressionEntity>)
      .orIgnore()
      .returning(['id'])
      .execute();
    const [row] = result.raw as { id: string }[];
    return row ? this.findById(row.id) : null;
  }

  async findById(id: string): Promise<NullableType<Compression>> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? CompressionMapper.toDomain(entity) : null;
  }

  async findBySession(agentSessionId: string): Promise<Compression[]> {
    const entities = await this.repository.find({
      where: { agentSessionId },
      order: { startIndex: 'ASC', createdAt: 'ASC' },
    });
    return entities.map((entity) => CompressionMapper.toDomain(entity));
  }

  async markReady(
    id: string,
    result: Pick<Compression, 'stateBlock' | 'tokensAfter' | 'usageRecordId'>,
  ): Promise<void> {
    await this.repository.update(
      { id, status: 'pending' },
      { ...result, status: 'ready', input: null, readyAt: new Date() },
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.repository.update(
      { id, status: 'pending' },
      { status: 'failed', error: error.slice(0, 100), input: null },
    );
  }
}
