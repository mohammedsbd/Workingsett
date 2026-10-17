import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { agentTools, systemPrompt } from '../agent/agents.js';
import { FullContext } from '../agent/context-strategy.js';
import { newSessionId, runAgent } from '../agent/runner.js';
import {
  isProvider,
  loadEnv,
  providerConfig,
  ROOT,
  ROUTES,
  type Route,
} from '../config.js';
import { createModel } from '../llm/models.js';
import { checkTask } from '../tasks/check.js';
import { loadTasks } from '../tasks/load.js';
import { AGENTS, type AgentName } from '../tasks/schema.js';
import { TOOL_MODES, type ToolMode } from '../tools/recorder.js';
import { SideEffectLog } from '../tools/side-effect-log.js';

const HELP = `Run a demo agent.

Usage: npm run agent -- --agent research|support [options]

  --task <id>        Run the tasks up to and including this one (q07, T03).
                     Default: all tasks.
  --mode <mode>      Tools: replay (default, uses recordings), record, live.
  --provider <name>  gemini (default, or DEMO_PROVIDER), groq, openai, anthropic.
  --via <route>      direct (default) or parsim (PARSIM_BASE_URL and PARSIM_API_KEY).
  --max-steps <n>    Most model calls per task (15).

Models, keys and limits come from demo-agent/.env (see .env.example).
Each run writes runs/<run id>/summary.json and side-effects.jsonl.`;

function fail(message: string): never {
  console.error(`${message}\n\n${HELP}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    agent: { type: 'string' },
    task: { type: 'string' },
    mode: { type: 'string', default: 'replay' },
    provider: { type: 'string' },
    via: { type: 'string', default: 'direct' },
    'max-steps': { type: 'string', default: '15' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

loadEnv();
const agent = values.agent as AgentName;
if (!(AGENTS as readonly string[]).includes(agent)) {
  fail('--agent must be research or support.');
}
const mode = values.mode as ToolMode;
if (!(TOOL_MODES as readonly string[]).includes(mode)) {
  fail('--mode must be record, replay or live.');
}
const via = values.via as Route;
if (!(ROUTES as readonly string[]).includes(via)) {
  fail('--via must be direct or parsim.');
}
const providerName = values.provider ?? process.env.DEMO_PROVIDER ?? 'gemini';
if (!isProvider(providerName)) {
  fail('--provider must be gemini, groq, openai or anthropic.');
}

const allTasks = loadTasks(agent);
const end = values.task
  ? allTasks.findIndex((t) => t.id === values.task)
  : allTasks.length - 1;
if (end < 0) fail(`There is no task ${values.task} for the ${agent} agent.`);
const tasks = allTasks.slice(0, end + 1);

let config;
try {
  config = providerConfig(providerName, via);
} catch (error) {
  fail((error as Error).message);
}

const sessionId = newSessionId(agent);
const runDir = path.join(ROOT, 'runs', sessionId);
const log = new SideEffectLog(path.join(runDir, 'side-effects.jsonl'));
const model = createModel(config, {
  onRetry: (attempt, waitMs) =>
    console.log(
      `  rate limited: retry ${attempt} in ${(waitMs / 1000).toFixed(1)}s`,
    ),
});

console.log(
  `${agent} agent: ${tasks.length} task(s), ${config.provider} ${config.model}, ${via}, tools in ${mode} mode`,
);
if (config.freeTier) {
  console.log(
    'Free tier: a development run. Never send real customer data through it.',
  );
}
console.log(`Session ${sessionId}`);

const result = await runAgent({
  agentName: agent,
  systemPrompt: systemPrompt(agent),
  tasks,
  tools: agentTools(agent, mode, log),
  model,
  strategy: new FullContext(),
  sessionId,
  maxStepsPerTask: Number(values['max-steps']),
  onStep: ({ step, taskId, toolCalls }) =>
    console.log(
      `  step ${step} ${taskId}: ${toolCalls.length ? toolCalls.join(', ') : 'answer'}`,
    ),
});

const checks = result.tasks.map((outcome) => {
  const task = tasks.find((t) => t.id === outcome.taskId)!;
  return { ...checkTask(task, log.entries), type: task.type };
});
await mkdir(runDir, { recursive: true });
await writeFile(
  path.join(runDir, 'summary.json'),
  `${JSON.stringify(
    {
      agent,
      provider: config.provider,
      model: config.model,
      route: via,
      toolMode: mode,
      freeTier: config.freeTier,
      ...result,
      checks,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log('');
for (const check of checks) {
  console.log(
    `${check.passed ? 'PASS' : 'FAIL'} ${check.taskId} (${check.type}): ${check.reason}`,
  );
}
const passed = checks.filter((c) => c.passed).length;
console.log(
  `\n${passed}/${checks.length} passed, ${result.steps} steps, ${result.toolCalls} tool calls, ${result.usage.inputTokens} input and ${result.usage.outputTokens} output tokens (${result.usage.cachedInputTokens} cached), ${(result.wallTimeMs / 1000).toFixed(1)}s`,
);
console.log(`Run files: ${runDir}`);
if (result.stop.reason === 'quota') {
  console.log(`\nStopped at ${result.stop.taskId}: ${result.stop.message}`);
  process.exit(2);
}
if (result.stop.reason === 'error') {
  console.error(
    `\nStopped at ${result.stop.taskId}: ${result.stop.name}: ${result.stop.message}`,
  );
  process.exit(1);
}
