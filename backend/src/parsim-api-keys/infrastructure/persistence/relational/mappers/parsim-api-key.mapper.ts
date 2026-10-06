import { ParsimApiKey } from '../../../../domain/parsim-api-key';
import { ParsimApiKeyEntity } from '../entities/parsim-api-key.entity';

export class ParsimApiKeyMapper {
  static toDomain(raw: ParsimApiKeyEntity): ParsimApiKey {
    const domainEntity = new ParsimApiKey();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.name = raw.name;
    domainEntity.prefix = raw.prefix;
    domainEntity.keyHash = raw.keyHash;
    domainEntity.lastUsedAt = raw.lastUsedAt;
    domainEntity.revokedAt = raw.revokedAt;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;
    return domainEntity;
  }
}
