import { GcMode } from '../../../../../gc/gc-config';
import { Upstream } from '../../../../../proxy/providers/provider-adapter';
import { UserMapper } from '../../../../../users/infrastructure/persistence/relational/mappers/user.mapper';
import { Project } from '../../../../domain/project';
import { ProjectEntity } from '../entities/project.entity';

export class ProjectMapper {
  static toDomain(raw: ProjectEntity): Project {
    const domainEntity = new Project();
    domainEntity.id = raw.id;
    domainEntity.name = raw.name;
    domainEntity.upstream = raw.upstream as Upstream;
    domainEntity.ownerId = raw.ownerId;
    if (raw.owner) {
      domainEntity.owner = UserMapper.toDomain(raw.owner);
    }
    domainEntity.providerKeyEncrypted = raw.providerKeyEncrypted;
    domainEntity.storeContent = raw.storeContent ?? null;
    domainEntity.gcMode = raw.gcMode as GcMode;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: Project): ProjectEntity {
    const persistenceEntity = new ProjectEntity();
    if (domainEntity.id) {
      persistenceEntity.id = domainEntity.id;
    }
    persistenceEntity.name = domainEntity.name;
    persistenceEntity.upstream = domainEntity.upstream;
    persistenceEntity.ownerId = domainEntity.ownerId;
    persistenceEntity.providerKeyEncrypted = domainEntity.providerKeyEncrypted;
    persistenceEntity.storeContent = domainEntity.storeContent;
    persistenceEntity.gcMode = domainEntity.gcMode;
    persistenceEntity.createdAt = domainEntity.createdAt;
    persistenceEntity.updatedAt = domainEntity.updatedAt;

    return persistenceEntity;
  }
}
