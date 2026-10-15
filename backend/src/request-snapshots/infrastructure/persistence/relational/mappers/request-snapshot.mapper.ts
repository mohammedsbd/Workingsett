import {
  RequestSnapshot,
  SnapshotBody,
} from '../../../../domain/request-snapshot';
import { RequestSnapshotEntity } from '../entities/request-snapshot.entity';

export class RequestSnapshotMapper {
  static toDomain(raw: RequestSnapshotEntity): RequestSnapshot {
    const domainEntity = new RequestSnapshot();
    domainEntity.id = raw.id;
    domainEntity.projectId = raw.projectId;
    domainEntity.agentSessionId = raw.agentSessionId;
    domainEntity.requestNumber = raw.requestNumber;
    domainEntity.usageRecordId = raw.usageRecordId;
    domainEntity.api = raw.api as RequestSnapshot['api'];
    domainEntity.model = raw.model;
    domainEntity.streamed = raw.streamed;
    domainEntity.original = raw.original as unknown as SnapshotBody;
    domainEntity.gc = raw.gc as unknown as SnapshotBody | null;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }
}
