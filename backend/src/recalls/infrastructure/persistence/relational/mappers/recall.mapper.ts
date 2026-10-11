import { Recall } from '../../../../domain/recall';
import { RecallEntity } from '../entities/recall.entity';

export class RecallMapper {
  static toDomain(raw: RecallEntity): Recall {
    const domainEntity = new Recall();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.agentSessionId = raw.agentSessionId;
    domainEntity.usageRecordId = raw.usageRecordId;
    domainEntity.archiveId = raw.archiveId;
    domainEntity.found = raw.found;
    domainEntity.refused = raw.refused;
    domainEntity.tokensRestored = raw.tokensRestored;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
