import {
  FixtureConversation,
  FixtureMessage,
  loadConversation,
} from './fixtures';

/**
 * A long agent session built from the research fixture: its system prompt
 * and goal, then its tool rounds (an assistant message with its tool
 * results, plus any user message) repeated until there are `rounds` of
 * them. Call ids are renumbered so every call is unique; the repeated
 * tool output gives the GC duplicates and superseded results to work on,
 * as a long-running agent re-fetching the same pages would.
 */
export function buildLongSession(rounds: number): FixtureConversation {
  const research = loadConversation('research-agent-session');
  const [system, goal, ...rest] = research.messages;

  const templates: FixtureMessage[][] = [];
  for (const message of rest) {
    if (message.role === 'assistant' || !templates.length) {
      templates.push([message]);
    } else {
      templates[templates.length - 1].push(message);
    }
  }

  const messages: FixtureMessage[] = [system, goal];
  let nextId = 0;
  for (let round = 0; round < rounds; round++) {
    const ids = new Map<string, string>();
    const rename = (id: string) => {
      if (!ids.has(id))
        ids.set(id, `call_long_${String(nextId++).padStart(5, '0')}`);
      return ids.get(id)!;
    };
    for (const message of templates[round % templates.length]) {
      if (message.role === 'assistant') {
        messages.push({
          ...message,
          ...(message.tool_calls && {
            tool_calls: message.tool_calls.map((call) => ({
              ...call,
              id: rename(call.id),
            })),
          }),
        });
      } else if (message.role === 'tool') {
        messages.push({
          ...message,
          tool_call_id: rename(message.tool_call_id),
        });
      } else {
        messages.push({ ...message });
      }
    }
  }
  return { ...research, id: 'long-research-session', messages };
}

/**
 * The requests an agent sends during a session: one per round, each with
 * the whole conversation up to the end of that round.
 */
export function sessionRequests(conversation: FixtureConversation): number[] {
  const cuts: number[] = [];
  conversation.messages.forEach((message, index) => {
    if (message.role === 'assistant' && index > 2) cuts.push(index);
  });
  return [...cuts, conversation.messages.length];
}
