import { NullableType } from '../../../utils/types/nullable.type';
import { FinishedReplayStatus, Replay } from '../../domain/replay';

export type NewReplay = Pick<
  Replay,
  | 'projectId'
  | 'agentSessionId'
  | 'requestNumbers'
  | 'budgetUsd'
  | 'estimatedCostUsd'
  | 'judgeKeySource'
  | 'judgeProvider'
  | 'judgeModel'
>;

export abstract class ReplayRepository {
  abstract create(replay: NewReplay): Promise<Replay>;

  abstract findById(id: string): Promise<NullableType<Replay>>;

  /** A session's replays, newest first. */
  abstract findBySession(agentSessionId: string): Promise<Replay[]>;

  /** Moves a queued replay to running; false if it was not queued. */
  abstract start(id: string): Promise<boolean>;

  /** Records finished points and the replay's total spend. */
  abstract progress(
    id: string,
    progress: Pick<Replay, 'pointsDone' | 'spentUsd'>,
  ): Promise<void>;

  abstract finish(
    id: string,
    status: FinishedReplayStatus,
    error: string | null,
  ): Promise<void>;
}
