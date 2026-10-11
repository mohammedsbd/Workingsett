import { GcDecision } from '../../domain/gc-decision';

export type NewGcDecision = Omit<GcDecision, 'id' | 'createdAt'>;

export abstract class GcDecisionRepository {
  /**
   * Inserts decisions not stored yet for their session (same item key).
   * Returns how many were new.
   */
  abstract insertMissing(decisions: NewGcDecision[]): Promise<number>;

  /** Decisions of a session in conversation order. */
  abstract findBySession(agentSessionId: string): Promise<GcDecision[]>;
}
