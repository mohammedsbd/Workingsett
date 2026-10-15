import type { ProxyApi } from '../../proxy/providers/provider-adapter';

/**
 * A request body split into content-addressed parts (see SnapshotPart):
 * the envelope's hash and the hash of each message, in order.
 */
export type SnapshotBody = {
  envelope: string;
  messages: string[];
};

/**
 * What one proxied request sent, so replay can rebuild it exactly: the
 * request as the client sent it and, when the GC changed it, the request
 * the GC produced (forwarded in on mode, only computed in shadow mode).
 * Only written when the project stores content.
 */
export class RequestSnapshot {
  id: string;
  projectId: string;
  agentSessionId: string;
  /** The session's request number (1-based), as in context_item. */
  requestNumber: number;
  usageRecordId: string | null;
  /** The client API the body is written in. */
  api: ProxyApi;
  model: string;
  streamed: boolean;
  original: SnapshotBody;
  /** Null when the GC left the request unchanged (or did not run). */
  gc: SnapshotBody | null;
  createdAt: Date;
}
