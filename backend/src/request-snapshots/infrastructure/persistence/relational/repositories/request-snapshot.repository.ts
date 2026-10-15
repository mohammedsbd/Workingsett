import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { RequestSnapshot } from '../../../../domain/request-snapshot';
import {
  NewRequestSnapshot,
  RequestSnapshotRepository,
} from '../../request-snapshot.repository';
import { RequestSnapshotEntity } from '../entities/request-snapshot.entity';
import { RequestSnapshotMapper } from '../mappers/request-snapshot.mapper';

@Injectable()
export class RequestSnapshotRelationalRepository implements RequestSnapshotRepository {
  constructor(
    @InjectRepository(RequestSnapshotEntity)
    private readonly repository: Repository<RequestSnapshotEntity>,
  ) {}

  async insert(snapshot: NewRequestSnapshot): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .insert()
      // TypeORM's deep-partial type cannot describe an arbitrary jsonb value.
      .values(
        snapshot as unknown as QueryDeepPartialEntity<RequestSnapshotEntity>,
      )
      .orIgnore()
      .execute();
  }

  async findOne(
    agentSessionId: string,
    requestNumber: number,
  ): Promise<NullableType<RequestSnapshot>> {
    const entity = await this.repository.findOne({
      where: { agentSessionId, requestNumber },
    });
    return entity ? RequestSnapshotMapper.toDomain(entity) : null;
  }

  async findBySession(agentSessionId: string): Promise<RequestSnapshot[]> {
    const entities = await this.repository.find({
      where: { agentSessionId },
      order: { requestNumber: 'ASC' },
    });
    return entities.map((entity) => RequestSnapshotMapper.toDomain(entity));
  }
}
