import { SnapshotPart } from '../../../../domain/snapshot-part';
import { SnapshotPartEntity } from '../entities/snapshot-part.entity';

export class SnapshotPartMapper {
  static toDomain(raw: SnapshotPartEntity): SnapshotPart {
    const domainEntity = new SnapshotPart();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.hash = raw.hash;
    domainEntity.json = raw.json;
    domainEntity.sizeBytes = raw.sizeBytes;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
