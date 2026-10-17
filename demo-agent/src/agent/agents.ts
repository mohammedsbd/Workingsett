import path from 'node:path';
import { ROOT } from '../config.js';
import type { AgentName } from '../tasks/schema.js';
import { RecordingStore, type ToolMode } from '../tools/recorder.js';
import { researchTools } from '../tools/research-tools.js';
import type { SideEffectLog } from '../tools/side-effect-log.js';
import { supportTools } from '../tools/support-tools.js';
import type { Tool } from '../tools/types.js';
import { ResearchWorld } from '../world/research-world.js';
import { SupportWorld } from '../world/support-world.js';

/** The two demo agents: their instructions and tools. */

export const RESEARCH_SYSTEM_PROMPT = `You are a research assistant working through a list of questions about energy storage sites, one question at a time.

For each question:
1. Search the web for the site.
2. Read its site profile and its news page with fetch_page.
3. Take a short note of the key figures with take_note.
4. Save your answer with save_report, using the question id given in the question.
5. Reply with one short sentence that states the answer.

Use only what the pages say; the sites are not in your training data. Some later questions ask about sites you researched earlier: answer those from what you read at the time.`;

export const SUPPORT_SYSTEM_PROMPT = `You are a customer support agent for an outdoor gear shop. You handle tickets one at a time.

For each ticket:
1. Look up the order with lookup_order.
2. Apply the policy below: set the ticket's status with update_ticket.
3. Send the customer one reply with send_reply.
4. Then answer with one short sentence summarizing what you did.

Policy, by order status:
- delayed: offer a credit of 10% of the order total. Status "credited". The reply states the credit amount in EUR with two decimals.
- damaged: send a replacement. Status "replacement_sent". The reply names the order id.
- lost: refund the full order total. Status "refunded". The reply states the refund amount in EUR with two decimals.
- delivered, but the customer did not receive it: open an investigation with the carrier. Status "investigating". The reply gives the tracking number.

Always honour details customers give you, such as a gift card for refunds, a phone number for the courier or a gift note, including details from their earlier tickets.`;

export function systemPrompt(agent: AgentName): string {
  return agent === 'research' ? RESEARCH_SYSTEM_PROMPT : SUPPORT_SYSTEM_PROMPT;
}

export const RECORDINGS_DIR = path.join(ROOT, 'recordings');

export function recordingStore(agent: AgentName): RecordingStore {
  return new RecordingStore(path.join(RECORDINGS_DIR, agent));
}

export function agentTools(
  agent: AgentName,
  mode: ToolMode,
  log: SideEffectLog,
  store = recordingStore(agent),
): Tool[] {
  return agent === 'research'
    ? researchTools(new ResearchWorld(), store, mode, log)
    : supportTools(new SupportWorld(), store, mode, log);
}
