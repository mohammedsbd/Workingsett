import { CanonicalContent } from '../../context/context-items';

/**
 * The original of an archived tool result, stored before the GC'd request
 * is forwarded so the model can recall it by archive id. Content-addressed
 * per project: the same content is stored once. Stored whatever the
 * project's storeContent setting, because archived content must stay
 * recallable.
 */
export class ArchivedItem {
  id: string;
  projectId: string;
  /** The id in the stub, derived from the content hash. */
  archiveId: string;
  toolName: string;
  contentHash: string;
  tokenCount: number;
  content: CanonicalContent;
  sizeBytes: number;
  createdAt: Date;
}
