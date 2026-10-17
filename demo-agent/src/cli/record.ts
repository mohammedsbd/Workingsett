import { parseArgs } from 'node:util';
import { agentTools } from '../agent/agents.js';
import { AGENTS, type AgentName } from '../tasks/schema.js';
import { SideEffectLog } from '../tools/side-effect-log.js';
import type { Tool, ToolContext } from '../tools/types.js';
import {
  REVISION_FROM_QUESTION,
  ResearchWorld,
} from '../world/research-world.js';
import { SupportWorld } from '../world/support-world.js';

/**
 * Records every result the demo agents' tools can return, so runs in
 * replay mode need no network and never miss a recording:
 *
 *   npm run record                 both agents
 *   npm run record -- --agent support
 *
 * Every search (one per site, plus "no results"), every page in every
 * revision (plus "not found"), and every order (plus "not found").
 */

const HELP = `Usage: npm run record -- [--agent research|support]`;

const { values } = parseArgs({
  options: { agent: { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log(HELP);
  process.exit(0);
}
const agents: AgentName[] = values.agent
  ? [values.agent as AgentName]
  : [...AGENTS];
if (agents.some((a) => !(AGENTS as readonly string[]).includes(a))) {
  console.error(HELP);
  process.exit(1);
}

const context = (taskIndex: number): ToolContext => ({
  taskId: 'record',
  taskIndex,
  step: 0,
});

function tool(tools: Tool[], name: string): Tool {
  const found = tools.find((t) => t.definition.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return found;
}

for (const agent of agents) {
  const tools = agentTools(agent, 'record', new SideEffectLog());
  let count = 0;
  const run = async (name: string, args: Record<string, unknown>, at = 1) => {
    await tool(tools, name).run(args, context(at));
    count += 1;
  };
  if (agent === 'research') {
    const world = new ResearchWorld();
    for (const subject of world.subjects) {
      await run('web_search', { query: subject.name });
    }
    await run('web_search', { query: 'no matching site' });
    for (const url of world.urls()) {
      await run('fetch_page', { url });
      if (world.revisionAt(url, REVISION_FROM_QUESTION) === 2) {
        await run('fetch_page', { url }, REVISION_FROM_QUESTION);
      }
    }
    await run('fetch_page', { url: 'https://unknown.example/page' });
  } else {
    const world = new SupportWorld();
    for (const order of world.orders) {
      await run('lookup_order', { order_id: order.id });
    }
    await run('lookup_order', { order_id: 'O-0000' });
  }
  console.log(`Recorded ${count} tool results for the ${agent} agent.`);
}
