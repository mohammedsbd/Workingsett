import { ContextItem } from '../../domain/context-item';

export type NewContextItem = Omit<ContextItem, 'id' | 'createdAt'>;

export abstract class ContextItemRepository {
  /**
   * Inserts items not stored yet for the session (same position and
   * content hash). Returns how many were new.
   */
  abstract insertMissing(items: NewContextItem[]): Promise<number>;

  /** Position and content hash of every stored item of a session. */
  abstract findKeys(
    agentSessionId: string,
  ): Promise<Pick<ContextItem, 'position' | 'contentHash'>[]>;

  /** Items of a session in conversation order. */
  abstract findBySession(agentSessionId: string): Promise<ContextItem[]>;
}
