import { Compression, CompressionInput } from '../../../../domain/compression';
import { CompressionEntity } from '../entities/compression.entity';

export class CompressionMapper {
  static toDomain(raw: CompressionEntity): Compression {
    const domainEntity = new Compression();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.agentSessionId = raw.agentSessionId;
    domainEntity.stretchKey = raw.stretchKey;
    domainEntity.startIndex = raw.startIndex;
    domainEntity.endIndex = raw.endIndex;
    domainEntity.firstTurn = raw.firstTurn;
    domainEntity.lastTurn = raw.lastTurn;
    domainEntity.status = raw.status as Compression['status'];
    domainEntity.input = raw.input as unknown as CompressionInput | null;
    domainEntity.stateBlock = raw.stateBlock;
    domainEntity.tokensBefore = raw.tokensBefore;
    domainEntity.tokensAfter = raw.tokensAfter;
    domainEntity.usageRecordId = raw.usageRecordId;
    domainEntity.error = raw.error;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.readyAt = raw.readyAt;
    return domainEntity;
  }
}
