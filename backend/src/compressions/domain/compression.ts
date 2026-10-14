import type { CanonicalContent } from '../../context/context-items';

export const COMPRESSION_STATUSES = ['pending', 'ready', 'failed'] as const;
export type CompressionStatus = (typeof COMPRESSION_STATUSES)[number];

/** One original message of a stretch, as given to the summarizer. */
export type StretchMessage = {
  /** Message index in the client's request. */
  index: number;
  /** 1-based turn number (a turn starts at each assistant message). */
  turn: number;
  role: 'assistant' | 'user' | 'tool';
  content: CanonicalContent;
  archiveId: string;
};

/** What the background job needs; cleared once the summary is ready. */
export type CompressionInput = {
  goal: string;
  messages: StretchMessage[];
  /** Compact lines for the side-effect calls kept in place. */
  actions: string[];
};

/**
 * A finished stretch of an agent session, summarized in the background into
 * a state block that later requests send in place of those turns.
 */
export class Compression {
  id: string;
  projectId: string;
  agentSessionId: string;
  /** Hash of the stretch's message range and content; see stretch.ts. */
  stretchKey: string;
  /** First message index of the stretch (an assistant message). */
  startIndex: number;
  /** Index just after the stretch (the first message of the protected tail). */
  endIndex: number;
  firstTurn: number;
  lastTurn: number;
  status: CompressionStatus;
  /** Null once the job finished (the originals are archived instead). */
  input: CompressionInput | null;
  /** The rendered block; fixed once ready, so it is reused byte for byte. */
  stateBlock: string | null;
  /** Tokens of the original stretch. */
  tokensBefore: number;
  /** Tokens of the state block (kept side-effect messages not included). */
  tokensAfter: number | null;
  /** Usage record of the summarization call. */
  usageRecordId: string | null;
  /** Short reason when failed (never content). */
  error: string | null;
  createdAt: Date;
  readyAt: Date | null;
}
