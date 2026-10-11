import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { AgentSession } from '../../../../domain/agent-session';
import {
  AgentSessionRepository,
  SessionSighting,
} from '../../agent-session.repository';
import { AgentSessionEntity } from '../entities/agent-session.entity';
import { AgentSessionMapper } from '../mappers/agent-session.mapper';

@Injectable()
export class AgentSessionRelationalRepository implements AgentSessionRepository {
  constructor(
    @InjectRepository(AgentSessionEntity)
    private readonly repository: Repository<AgentSessionEntity>,
  ) {}

  async recordRequest(sighting: SessionSighting): Promise<AgentSession> {
    // One statement, so concurrent requests of the same session never lose
    // a count or create the session twice.
    const rows: AgentSessionEntity[] = await this.repository.query(
      `INSERT INTO agent_session
         ("projectId", "externalId", "idSource", provider, model,
          "firstSeenAt", "lastSeenAt", "requestCount")
       VALUES ($1, $2, $3, $4, $5, $6, $6, 1)
       ON CONFLICT ("projectId", "externalId") DO UPDATE SET
         "requestCount" = agent_session."requestCount" + 1,
         "lastSeenAt" = GREATEST(agent_session."lastSeenAt", EXCLUDED."lastSeenAt"),
         model = EXCLUDED.model
       RETURNING *`,
      [
        sighting.projectId,
        sighting.externalId,
        sighting.idSource,
        sighting.provider,
        sighting.model,
        sighting.at,
      ],
    );
    return AgentSessionMapper.toDomain(rows[0]);
  }

  async findByExternalId(
    projectId: string,
    externalId: string,
  ): Promise<NullableType<AgentSession>> {
    const entity = await this.repository.findOne({
      where: { projectId, externalId },
    });
    return entity ? AgentSessionMapper.toDomain(entity) : null;
  }

  async findByProject(projectId: string): Promise<AgentSession[]> {
    const entities = await this.repository.find({
      where: { projectId },
      order: { lastSeenAt: 'DESC' },
    });
    return entities.map((entity) => AgentSessionMapper.toDomain(entity));
  }
}
