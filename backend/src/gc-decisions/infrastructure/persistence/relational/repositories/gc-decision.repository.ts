import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GcDecision } from '../../../../domain/gc-decision';
import {
  GcDecisionRepository,
  NewGcDecision,
} from '../../gc-decision.repository';
import { GcDecisionEntity } from '../entities/gc-decision.entity';
import { GcDecisionMapper } from '../mappers/gc-decision.mapper';

/** Rows per INSERT, to stay well under Postgres' parameter limit. */
const BATCH = 200;

@Injectable()
export class GcDecisionRelationalRepository implements GcDecisionRepository {
  constructor(
    @InjectRepository(GcDecisionEntity)
    private readonly repository: Repository<GcDecisionEntity>,
  ) {}

  async insertMissing(decisions: NewGcDecision[]): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < decisions.length; i += BATCH) {
      const result = await this.repository
        .createQueryBuilder()
        .insert()
        .values(decisions.slice(i, i + BATCH))
        // A concurrent request of the same session may have stored it first.
        .orIgnore()
        .returning(['id'])
        .execute();
      // RETURNING only yields the rows that were actually inserted.
      inserted += (result.raw as unknown[]).length;
    }
    return inserted;
  }

  async findBySession(agentSessionId: string): Promise<GcDecision[]> {
    const entities = await this.repository.find({
      where: { agentSessionId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return entities.map((entity) => GcDecisionMapper.toDomain(entity));
  }
}
