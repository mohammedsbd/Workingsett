import { ContextItemKind } from '../../context/context-items';

/**
 * One piece of an agent session's context: a system prompt, a user or
 * assistant message, a tool call or a tool result. The content itself is in
 * context_content, keyed by contentHash.
 */
export class ContextItem {
  id: string;
  agentSessionId: string;
  /** 0-based position in the conversation. */
  position: number;
  role: string;
  kind: ContextItemKind;
  /** Tool call id, for tool_call and tool_result items. */
  toolCallId: string | null;
  contentHash: string;
  tokenCount: number;
  /** "tiktoken:<encoding>" (exact) or "approx:<encoding>". */
  tokenizer: string;
  /** The session's request number (1-based) that first contained the item. */
  firstSeenRequest: number;
  createdAt: Date;
}
