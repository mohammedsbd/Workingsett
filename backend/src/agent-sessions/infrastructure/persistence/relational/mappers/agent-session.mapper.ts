import { AgentSession } from '../../../../domain/agent-session';
import { AgentSessionEntity } from '../entities/agent-session.entity';

export class AgentSessionMapper {
  static toDomain(raw: AgentSessionEntity): AgentSession {
    const domainEntity = new AgentSession();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.externalId = raw.externalId;
    domainEntity.idSource = raw.idSource === 'header' ? 'header' : 'derived';
    domainEntity.provider = raw.provider;
    domainEntity.model = raw.model;
    domainEntity.firstSeenAt = raw.firstSeenAt;
    domainEntity.lastSeenAt = raw.lastSeenAt;
    domainEntity.requestCount = raw.requestCount;
    return domainEntity;
  }
}
