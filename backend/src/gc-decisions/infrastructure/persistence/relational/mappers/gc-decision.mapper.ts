import { GcDecision } from '../../../../domain/gc-decision';
import { GcDecisionEntity } from '../entities/gc-decision.entity';

export class GcDecisionMapper {
  static toDomain(raw: GcDecisionEntity): GcDecision {
    const domainEntity = new GcDecision();
    domainEntity.id = raw.id;
    domainEntity.gcRunId = raw.gcRunId;
    domainEntity.agentSessionId = raw.agentSessionId;
    domainEntity.itemKey = raw.itemKey;
    domainEntity.position = raw.position;
    domainEntity.toolCallId = raw.toolCallId;
    domainEntity.toolName = raw.toolName;
    domainEntity.contentHash = raw.contentHash;
    domainEntity.decision = raw.decision as GcDecision['decision'];
    domainEntity.reason = raw.reason as GcDecision['reason'];
    domainEntity.detail = raw.detail;
    domainEntity.tokensBefore = raw.tokensBefore;
    domainEntity.tokensAfter = raw.tokensAfter;
    domainEntity.replacement = raw.replacement;
    domainEntity.archiveId = raw.archiveId;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
