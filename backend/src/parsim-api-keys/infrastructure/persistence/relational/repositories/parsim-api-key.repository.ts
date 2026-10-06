import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { ParsimApiKey } from '../../../../domain/parsim-api-key';
import {
  NewParsimApiKey,
  ParsimApiKeyRepository,
} from '../../parsim-api-key.repository';
import { ParsimApiKeyEntity } from '../entities/parsim-api-key.entity';
import { ParsimApiKeyMapper } from '../mappers/parsim-api-key.mapper';

@Injectable()
export class ParsimApiKeyRelationalRepository implements ParsimApiKeyRepository {
  constructor(
    @InjectRepository(ParsimApiKeyEntity)
    private readonly repository: Repository<ParsimApiKeyEntity>,
  ) {}

  async create(data: NewParsimApiKey): Promise<ParsimApiKey> {
    const entity = await this.repository.save(
      this.repository.create({ ...data, lastUsedAt: null, revokedAt: null }),
    );
    return ParsimApiKeyMapper.toDomain(entity);
  }

  async findByHash(keyHash: string): Promise<NullableType<ParsimApiKey>> {
    const entity = await this.repository.findOne({ where: { keyHash } });
    return entity ? ParsimApiKeyMapper.toDomain(entity) : null;
  }

  async findByProject(projectId: string): Promise<ParsimApiKey[]> {
    const entities = await this.repository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => ParsimApiKeyMapper.toDomain(entity));
  }

  async findById(id: ParsimApiKey['id']): Promise<NullableType<ParsimApiKey>> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? ParsimApiKeyMapper.toDomain(entity) : null;
  }

  async markUsed(id: ParsimApiKey['id'], at: Date): Promise<void> {
    await this.repository.update({ id }, { lastUsedAt: at });
  }

  async revoke(
    id: ParsimApiKey['id'],
    at: Date,
  ): Promise<NullableType<ParsimApiKey>> {
    await this.repository.update(
      { id, revokedAt: IsNull() },
      { revokedAt: at },
    );
    return this.findById(id);
  }
}
