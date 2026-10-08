/**
 * The content of a context item, stored once per project per content hash,
 * no matter how many items or sessions contain it. Only written when the
 * project stores content.
 */
export class ContextContent {
  id: string;
  projectId: string;
  /** SHA-256 of the canonical JSON of `content`. */
  hash: string;
  /** Provider-neutral content (see CanonicalContent). */
  content: Record<string, unknown>;
  /** Size of the canonical JSON in bytes. */
  sizeBytes: number;
  createdAt: Date;
}
