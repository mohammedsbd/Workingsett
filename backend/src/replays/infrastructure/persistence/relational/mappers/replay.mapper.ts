import { Replay } from '../../../../domain/replay';
import { ReplayEntity } from '../entities/replay.entity';

export class ReplayMapper {
  static toDomain(raw: ReplayEntity): Replay {
    const domainEntity = new Replay();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.agentSessionId = raw.agentSessionId;
    domainEntity.status = raw.status as Replay['status'];
    domainEntity.requestNumbers = raw.requestNumbers;
    domainEntity.budgetUsd = raw.budgetUsd;
    domainEntity.estimatedCostUsd = raw.estimatedCostUsd;
    domainEntity.spentUsd = raw.spentUsd;
    domainEntity.judgeKeySource =
      raw.judgeKeySource as Replay['judgeKeySource'];
    domainEntity.judgeProvider = raw.judgeProvider;
    domainEntity.judgeModel = raw.judgeModel;
    domainEntity.pointsDone = raw.pointsDone;
    domainEntity.error = raw.error;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.startedAt = raw.startedAt;
    domainEntity.finishedAt = raw.finishedAt;
    return domainEntity;
  }
}
