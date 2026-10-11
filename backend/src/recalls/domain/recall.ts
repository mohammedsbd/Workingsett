/**
 * One parsim_recall call that Parsim answered for the model. Holds the
 * archive id and how much content was restored, never the content.
 */
export class Recall {
  id: string;
  projectId: string;
  agentSessionId: string | null;
  /** The usage record of the client request that made the recall. */
  usageRecordId: string | null;
  /** The archive id the model asked for ("" if it gave none). */
  archiveId: string;
  /** Whether the archive was found; false answers say "not found". */
  found: boolean;
  /** Whether the call was over the per-request limit and refused. */
  refused: boolean;
  /** Tokens of the archived original sent back to the model (0 if none). */
  tokensRestored: number;
  createdAt: Date;
}
