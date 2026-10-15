/**
 * One piece of a recorded request, stored once per project: a message
 * exactly as the client sent it (provider JSON, with tool call ids), or a
 * request's envelope (every field except the message list: model, tools,
 * parameters). Kept as JSON text so key order survives, and addressed by
 * the SHA-256 of that text. Only written when the project stores content.
 */
export class SnapshotPart {
  id: string;
  projectId: string;
  hash: string;
  json: string;
  sizeBytes: number;
  createdAt: Date;
}
