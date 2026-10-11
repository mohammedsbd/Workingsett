import { GcRun } from '../../../../domain/gc-run';
import { GcRunEntity } from '../entities/gc-run.entity';

export class GcRunMapper {
  static toDomain(raw: GcRunEntity): GcRun {
    const domainEntity = new GcRun();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.agentSessionId = raw.agentSessionId;
    domainEntity.usageRecordId = raw.usageRecordId;
    domainEntity.mode = raw.mode as GcRun['mode'];
    domainEntity.ran = raw.ran;
    domainEntity.applied = raw.applied;
    domainEntity.failed = raw.failed;
    domainEntity.error = raw.error;
    domainEntity.tokensBefore = raw.tokensBefore;
    domainEntity.tokensAfter = raw.tokensAfter;
    domainEntity.decisionCount = raw.decisionCount;
    domainEntity.newDecisionCount = raw.newDecisionCount;
    domainEntity.durationMs = raw.durationMs;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
