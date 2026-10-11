import { ArchivedItem } from '../../../../domain/archived-item';
import { ArchivedItemEntity } from '../entities/archived-item.entity';

export class ArchivedItemMapper {
  static toDomain(raw: ArchivedItemEntity): ArchivedItem {
    const domainEntity = new ArchivedItem();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.archiveId = raw.archiveId;
    domainEntity.toolName = raw.toolName;
    domainEntity.contentHash = raw.contentHash;
    domainEntity.tokenCount = raw.tokenCount;
    domainEntity.content = raw.content as unknown as ArchivedItem['content'];
    domainEntity.sizeBytes = raw.sizeBytes;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
