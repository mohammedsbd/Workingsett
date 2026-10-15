import { STATE_BLOCK_START } from '../compression/state-block';
import { archiveStubIds } from './archive-stubs';

/**
 * Whether a request body (as JSON text) points at archived originals: an
 * archive stub or a state block. Such a request is sent with parsim_recall.
 */
export function hasRecallableContent(text: string): boolean {
  return archiveStubIds(text).length > 0 || text.includes(STATE_BLOCK_START);
}
