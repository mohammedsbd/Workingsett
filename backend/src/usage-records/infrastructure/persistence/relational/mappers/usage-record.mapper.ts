import { UsageRecord } from '../../../../domain/usage-record';
import { UsageRecordEntity } from '../entities/usage-record.entity';

export class UsageRecordMapper {
  static toDomain(raw: UsageRecordEntity): UsageRecord {
    const domainEntity = new UsageRecord();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.upstream = raw.upstream;
    domainEntity.model = raw.model;
    domainEntity.inputTokens = raw.inputTokens;
    domainEntity.outputTokens = raw.outputTokens;
    domainEntity.cachedInputTokens = raw.cachedInputTokens;
    domainEntity.costUsd = raw.costUsd;
    domainEntity.latencyMs = raw.latencyMs;
    domainEntity.status = raw.status;
    domainEntity.streamed = raw.streamed;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
