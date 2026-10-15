import { NullableType } from '../../../utils/types/nullable.type';
import { RequestSnapshot } from '../../domain/request-snapshot';

export type NewRequestSnapshot = Omit<RequestSnapshot, 'id' | 'createdAt'>;

export abstract class RequestSnapshotRepository {
  /** Stores the snapshot; ignored if the request already has one. */
  abstract insert(snapshot: NewRequestSnapshot): Promise<void>;

  abstract findOne(
    agentSessionId: string,
    requestNumber: number,
  ): Promise<NullableType<RequestSnapshot>>;

  /** Every snapshot of a session, by request number. */
  abstract findBySession(agentSessionId: string): Promise<RequestSnapshot[]>;
}
