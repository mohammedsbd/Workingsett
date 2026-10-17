import type { ChatMessage } from '../llm/types.js';

/**
 * How the agent builds each request's messages from its full history.
 * The default sends everything. Step 16b plugs naive truncation and naive
 * summarization in here as baselines. Parsim is never a strategy: it is
 * selected by pointing the SDK's base URL at the proxy, with the full
 * context, exactly like a real customer's agent.
 *
 * A strategy may drop or replace messages, but must keep tool calls and
 * their results together, and must not change the content of messages it
 * keeps (assistant messages carry provider content that is sent back).
 */
export interface ContextStrategy {
  readonly name: string;
  build(history: readonly ChatMessage[]): Promise<ChatMessage[]>;
}

export class FullContext implements ContextStrategy {
  readonly name = 'full';

  build(history: readonly ChatMessage[]): Promise<ChatMessage[]> {
    return Promise.resolve([...history]);
  }
}
