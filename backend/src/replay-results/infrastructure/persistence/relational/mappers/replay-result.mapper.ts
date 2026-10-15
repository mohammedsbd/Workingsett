import { ReplayResult, ReplayVariant } from '../../../../domain/replay-result';
import { ReplayResultEntity } from '../entities/replay-result.entity';

export class ReplayResultMapper {
  static toDomain(raw: ReplayResultEntity): ReplayResult {
    const domainEntity = new ReplayResult();
    domainEntity.id = raw.id;
    domainEntity.replayId = raw.replayId;
    domainEntity.requestNumber = raw.requestNumber;
    domainEntity.status = raw.status as ReplayResult['status'];
    domainEntity.gcChanged = raw.gcChanged;
    domainEntity.original = raw.original as unknown as ReplayVariant | null;
    domainEntity.gc = raw.gc as unknown as ReplayVariant | null;
    domainEntity.exactMatch = raw.exactMatch;
    domainEntity.toolCallsMatch = raw.toolCallsMatch;
    domainEntity.judgeScore = raw.judgeScore;
    domainEntity.judgeReason = raw.judgeReason;
    domainEntity.judgeCostUsd = raw.judgeCostUsd;
    domainEntity.agreed = raw.agreed;
    domainEntity.error = raw.error;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
