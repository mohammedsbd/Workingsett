import { ReplayResult } from '../../domain/replay-result';

export type NewReplayResult = Omit<ReplayResult, 'id' | 'createdAt'>;

export abstract class ReplayResultRepository {
  /** Stores a point's result; ignored if the point already has one. */
  abstract insert(result: NewReplayResult): Promise<void>;

  /** A replay's results, by request number. */
  abstract findByReplay(replayId: string): Promise<ReplayResult[]>;
}
