import { SnapshotPart } from '../../domain/snapshot-part';

export type NewSnapshotPart = Pick<
  SnapshotPart,
  'projectId' | 'hash' | 'json' | 'sizeBytes'
>;

export abstract class SnapshotPartRepository {
  /** Inserts the parts not stored yet; returns how many were new. */
  abstract insertMissing(parts: NewSnapshotPart[]): Promise<number>;

  /** The JSON text of each hash found, keyed by hash. */
  abstract findJson(
    projectId: string,
    hashes: string[],
  ): Promise<Map<string, string>>;
}
