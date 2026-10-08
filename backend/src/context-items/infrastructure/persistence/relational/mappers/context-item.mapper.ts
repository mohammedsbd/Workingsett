import { ContextItemKind } from '../../../../../context/context-items';
import { ContextItem } from '../../../../domain/context-item';
import { ContextItemEntity } from '../entities/context-item.entity';

export class ContextItemMapper {
  static toDomain(raw: ContextItemEntity): ContextItem {
    const domainEntity = new ContextItem();
    domainEntity.id = raw.id;
    domainEntity.agentSessionId = raw.agentSessionId;
    domainEntity.position = raw.position;
    domainEntity.role = raw.role;
    domainEntity.kind = raw.kind as ContextItemKind;
    domainEntity.toolCallId = raw.toolCallId;
    domainEntity.contentHash = raw.contentHash;
    domainEntity.tokenCount = raw.tokenCount;
    domainEntity.tokenizer = raw.tokenizer;
    domainEntity.firstSeenRequest = raw.firstSeenRequest;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
