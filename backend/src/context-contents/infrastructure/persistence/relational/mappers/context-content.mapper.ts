import { ContextContent } from '../../../../domain/context-content';
import { ContextContentEntity } from '../entities/context-content.entity';

export class ContextContentMapper {
  static toDomain(raw: ContextContentEntity): ContextContent {
    const domainEntity = new ContextContent();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.hash = raw.hash;
    domainEntity.content = raw.content;
    domainEntity.sizeBytes = raw.sizeBytes;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
