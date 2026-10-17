import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { agentTools, RECORDINGS_DIR, systemPrompt } from '../agent/agents.js';
import {
  dailyQuotaFit,
  estimateBench,
  BudgetTracker,
} from '../bench/budget.js';
import { ScriptedUpstream } from '../bench/fake-upstream.js';
import { ParsimClient, type ParsimUpstream } from '../bench/parsim-client.js';
import {
  DRY_RUN_PRICE,
  loadPrices,
  priceOf,
  type Price,
} from '../bench/prices.js';
import { ProgressStore, type BenchProgress } from '../bench/progress.js';
import {
  renderJson,
  renderMarkdown,
  renderSvg,
  reportFiles,
  summarizeArms,
  headline,
} from '../bench/report.js';
import { runBench } from '../bench/run-bench.js';
import {
  ARMS,
  PARSIM_ARMS,
  type Arm,
  type BenchConfig,
} from '../bench/types.js';
import {
  isProvider,
  loadEnv,
  providerConfig,
  ROOT,
  viaParsim,
  type ProviderConfig,
} from '../config.js';
import { createModel } from '../llm/models.js';
import type { ProviderName } from '../llm/types.js';
import { loadTasks } from '../tasks/load.js';
import { AGENTS, type AgentName } from '../tasks/schema.js';
import { SideEffectLog } from '../tools/side-effect-log.js';

const HELP = `Benchmark Parsim against naive baselines.

Usage: npm run bench -- --agent research|support [options]

  --runs <n>          Runs of every arm (default 1).
  --provider <name>   gemini, groq, openai or anthropic (default DEMO_PROVIDER).
  --model <model>     Overrides <PROVIDER>_MODEL.
  --arms <list>       all (default), or a comma list of: ${ARMS.join(', ')}.
  --tasks <n>         Only the first n tasks of the agent (default all).
  --budget <usd>      Stop cleanly once spending (at list price) passes this.
  --yes               Start without asking (free-tier providers only).
  --resume            Continue the newest unfinished bench of this agent,
                      provider and model, without repeating finished tasks.
  --judge             Also grade every task with the internal model.
  --dry-run           Run everything against a scripted fake upstream (no
                      real calls). Parsim arms need a Parsim whose OpenAI base
                      URL points at it (see --fake-port).
  --fake-port <n>     Port of the scripted upstream in a dry run (default any).
  --parsim-url <url>  Parsim for the parsim arms (default PARSIM_BASE_URL).
  --out-dir <dir>     Where the report goes (default docs/benchmarks, or the
                      bench's runs/ folder for a dry run).
  --max-steps <n>     Most model calls per task (15).

The internal model (summarize baseline, judge) is BENCH_INTERNAL_PROVIDER and
BENCH_INTERNAL_MODEL, by default the benchmarked provider and model.`;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    agent: { type: 'string' },
    runs: { type: 'string', default: '1' },
    provider: { type: 'string' },
    model: { type: 'string' },
    arms: { type: 'string', default: 'all' },
    tasks: { type: 'string' },
    budget: { type: 'string' },
    yes: { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    judge: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'fake-port': { type: 'string' },
    'parsim-url': { type: 'string' },
    'out-dir': { type: 'string' },
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
if (!(AGENTS as readonly string[]).includes(agent))
  fail(`--agent must be research or support.\n\n${HELP}`);
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1)
  fail('--runs must be a positive whole number.');
const arms = (
  values.arms === 'all'
    ? [...ARMS]
    : values.arms!.split(',').map((a) => a.trim())
) as Arm[];
if (
  !arms.length ||
  arms.some((a) => !(ARMS as readonly string[]).includes(a))
) {
  fail(`--arms must be all or a list of: ${ARMS.join(', ')}.`);
}
const dryRun = values['dry-run'];
const allTasks = loadTasks(agent);
const taskCount = values.tasks ? Number(values.tasks) : allTasks.length;
if (
  !Number.isInteger(taskCount) ||
  taskCount < 1 ||
  taskCount > allTasks.length
) {
  fail(`--tasks must be between 1 and ${allTasks.length}.`);
}
const tasks = allTasks.slice(0, taskCount);
const budget = values.budget ? Number(values.budget) : null;
if (budget !== null && !(budget > 0))
  fail('--budget must be a positive number of USD.');

// The benchmarked model and the internal model.
let fake: ScriptedUpstream | null = null;
let modelConfig: ProviderConfig;
let internalConfig: ProviderConfig;
let modelPrice: Price;
let internalPrice: Price;
let priceNote: string;
if (dryRun) {
  fake = new ScriptedUpstream();
  const fakeUrl = await fake.start(
    values['fake-port'] ? Number(values['fake-port']) : 0,
  );
  modelConfig = {
    provider: 'openai',
    model: 'scripted-agent',
    apiKey: 'dry-run',
    baseUrl: `${fakeUrl}/v1`,
    headers: {},
    maxOutputTokens: 512,
    temperature: 0,
    freeTier: false,
    route: 'direct',
  };
  internalConfig = modelConfig;
  modelPrice = DRY_RUN_PRICE;
  internalPrice = DRY_RUN_PRICE;
  priceNote = 'Made-up prices for the dry run.';
} else {
  const provider = values.provider ?? process.env.DEMO_PROVIDER ?? 'gemini';
  if (!isProvider(provider))
    fail('--provider must be gemini, groq, openai or anthropic.');
  const prefix = provider.toUpperCase();
  const env = {
    ...process.env,
    ...(values.model && { [`${prefix}_MODEL`]: values.model }),
  };
  try {
    modelConfig = providerConfig(provider, 'direct', env);
    const internalProvider = process.env.BENCH_INTERNAL_PROVIDER || provider;
    if (!isProvider(internalProvider))
      fail(
        'BENCH_INTERNAL_PROVIDER must be gemini, groq, openai or anthropic.',
      );
    const internalPrefix = internalProvider.toUpperCase();
    internalConfig = providerConfig(
      internalProvider as ProviderName,
      'direct',
      {
        ...env,
        ...(process.env.BENCH_INTERNAL_MODEL && {
          [`${internalPrefix}_MODEL`]: process.env.BENCH_INTERNAL_MODEL,
        }),
      },
    );
    const prices = loadPrices();
    modelPrice = priceOf(prices, modelConfig.model);
    internalPrice = priceOf(prices, internalConfig.model);
  } catch (error) {
    fail((error as Error).message);
  }
  priceNote = modelConfig.freeTier
    ? 'Free tier: the run cost nothing; costs are at the list price, so arms can be compared.'
    : 'From backend/config/model-prices.json.';
}

const needsParsim = arms.some((a) => PARSIM_ARMS.includes(a));
const parsimUrl = (
  values['parsim-url'] ??
  process.env.PARSIM_BASE_URL ??
  ''
).replace(/\/+$/, '');
if (needsParsim && !parsimUrl)
  fail('The parsim arms need --parsim-url or PARSIM_BASE_URL.');

// Progress: a new bench, or the newest unfinished one with --resume.
const store = new ProgressStore(path.join(ROOT, 'runs', 'bench'));
let progress: BenchProgress | null = null;
if (values.resume) {
  progress = await store.latestUnfinished({
    agent,
    provider: modelConfig.provider,
    model: modelConfig.model,
    dryRun,
  });
  if (!progress)
    fail(
      'There is no unfinished bench of this agent, provider and model to resume.',
    );
  console.log(`Resuming bench ${progress.id}.`);
}

const gitCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
})();
const parsimVersion = await readFile(
  path.join(ROOT, '..', 'backend', 'package.json'),
  'utf8',
)
  .then(
    (text) => `backend ${(JSON.parse(text) as { version: string }).version}`,
  )
  .catch(() => 'unknown');

if (!progress) {
  const startedAt = new Date().toISOString();
  const config: BenchConfig = {
    agent,
    provider: dryRun ? 'dry-run' : modelConfig.provider,
    model: modelConfig.model,
    internalModel: internalConfig.model,
    runs,
    arms,
    taskCount,
    truncateTurns: Number(process.env.BENCH_TRUNCATE_TURNS || 6),
    summaryEvery: Number(process.env.BENCH_SUMMARY_EVERY || 6),
    dryRun,
    freeTier: modelConfig.freeTier,
    judge: values.judge,
    command: `npm run bench -- ${process.argv.slice(2).join(' ')}`,
    parsimVersion,
    gitCommit,
    startedAt,
    prices: { model: modelPrice, internal: internalPrice, note: priceNote },
  };
  progress = {
    id: `${startedAt.slice(0, 19).replace(/[:T]/g, '-')}-${agent}-${randomUUID().slice(0, 6)}`,
    config,
    parsimKeys: {},
    parsimProjects: {},
    units: [],
  };
}
const config = progress.config;

// The estimate and the confirmation (not for dry runs).
if (!dryRun) {
  const recordingDir = path.join(RECORDINGS_DIR, agent);
  let chars = 0;
  let files = 0;
  for (const tool of await readdir(recordingDir)) {
    for (const file of await readdir(path.join(recordingDir, tool))) {
      const recording = JSON.parse(
        await readFile(path.join(recordingDir, tool, file), 'utf8'),
      ) as { result: string };
      chars += recording.result.length;
      files += 1;
    }
  }
  const tools = agentTools(agent, 'replay', new SideEffectLog()).map(
    (t) => t.definition,
  );
  const estimate = estimateBench({
    arms: config.arms,
    runs: config.runs,
    tasks,
    systemPrompt: systemPrompt(agent),
    tools,
    avgToolResultChars: files ? chars / files : 1000,
    truncateTurns: config.truncateTurns,
    summaryEvery: config.summaryEvery,
    modelPrice,
    internalPrice,
  });
  console.log(
    `\nEstimate for ${config.runs} run(s) of ${tasks.length} ${agent} task(s), ${modelConfig.provider} ${modelConfig.model}:`,
  );
  for (const a of estimate.arms) {
    console.log(
      `  ${a.arm.padEnd(14)} ${String(a.requests).padStart(5)} requests  ${a.inputTokens.toLocaleString('en-US').padStart(11)} in  ${a.outputTokens.toLocaleString('en-US').padStart(9)} out  $${a.costUsd.toFixed(4)}`,
    );
  }
  console.log(
    `  ${'total'.padEnd(14)} ${String(estimate.total.requests).padStart(5)} requests  ${estimate.total.inputTokens.toLocaleString('en-US').padStart(11)} in  ${estimate.total.outputTokens.toLocaleString('en-US').padStart(9)} out  $${estimate.total.costUsd.toFixed(4)}${modelConfig.freeTier ? ' at list price (free tier)' : ''}`,
  );
  if (modelConfig.freeTier) {
    const prefix = modelConfig.provider.toUpperCase();
    const fit = dailyQuotaFit(estimate.total, {
      tokens: Number(process.env[`${prefix}_DAILY_TOKENS`] || 0) || undefined,
      requests:
        Number(process.env[`${prefix}_DAILY_REQUESTS`] || 0) || undefined,
    });
    console.log(
      fit.fits
        ? '  Fits the daily free-tier quota.'
        : `  Does not fit one day's free-tier quota (limited by ${fit.limitedBy}): about ${fit.days} days. Continue each day with --resume.`,
    );
  }
  if (values.yes && !modelConfig.freeTier)
    fail('--yes is only for free-tier providers; confirm paid runs yourself.');
  if (!values.yes) {
    if (!process.stdin.isTTY)
      fail(
        'Confirmation needed: run in a terminal, or use --yes for a free-tier provider.',
      );
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question('Start? (y/N) ');
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) fail('Not started.', 0);
  }
}

// Parsim projects for the parsim arms (created once per bench).
let parsim: ParsimClient | null = null;
if (needsParsim) {
  const email = process.env.BENCH_PARSIM_EMAIL;
  const password = process.env.BENCH_PARSIM_PASSWORD;
  if (!email || !password)
    fail(
      'The parsim arms need BENCH_PARSIM_EMAIL and BENCH_PARSIM_PASSWORD (a Parsim user).',
    );
  parsim = new ParsimClient(parsimUrl, email, password);
  await parsim.login();
  const upstream: ParsimUpstream = dryRun
    ? 'openai'
    : modelConfig.provider === 'groq'
      ? 'openai-compatible'
      : (modelConfig.provider as ParsimUpstream);
  for (const arm of config.arms.filter((a) => PARSIM_ARMS.includes(a))) {
    if (progress.parsimKeys[arm]) continue;
    const { projectId, key } = await parsim.projectForArm(
      arm,
      config.provider,
      upstream,
      modelConfig.baseUrl,
      process.env.BENCH_PARSIM_COMPRESSION === 'true',
    );
    progress.parsimKeys[arm] = key;
    progress.parsimProjects[arm] = projectId;
  }
}
await store.save(progress);

const tracker = new BudgetTracker(budget);
const internalModel = createModel(internalConfig);
const { results, complete } = await runBench({
  tasks,
  systemPrompt: systemPrompt(agent),
  agentName: agent,
  tools: (log) => agentTools(agent, 'replay', log),
  model: (arm, key) =>
    createModel(
      PARSIM_ARMS.includes(arm) && key
        ? viaParsim(modelConfig, parsimUrl, key)
        : modelConfig,
      {
        onRetry: (attempt, waitMs) =>
          console.log(
            `  rate limited: retry ${attempt} in ${(waitMs / 1000).toFixed(1)}s`,
          ),
      },
    ),
  internalModel,
  modelPrice,
  internalPrice,
  parsim,
  progress,
  store,
  budget: tracker,
  judge: config.judge,
  maxStepsPerTask: Number(values['max-steps']),
  log: (line) => console.log(line),
});
await fake?.stop();

// The report (also for an incomplete bench: partial results).
if (results.results.length) {
  const summaries = summarizeArms(results);
  const files = reportFiles(results);
  const outDir = values['out-dir']
    ? path.resolve(values['out-dir'])
    : dryRun
      ? path.join(store.dir, progress.id)
      : path.join(ROOT, '..', 'docs', 'benchmarks');
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, files.markdown),
    renderMarkdown(results, summaries, files),
    'utf8',
  );
  await writeFile(
    path.join(outDir, files.json),
    renderJson(results, summaries),
    'utf8',
  );
  await writeFile(path.join(outDir, files.svg), renderSvg(summaries), 'utf8');
  console.log(`\n${headline(summaries)}`);
  console.log(`Report: ${path.join(outDir, files.markdown)}`);
}
if (!complete) {
  console.log(
    `\nThe bench stopped early (spent $${tracker.spentUsd.toFixed(4)} at list price). Continue with --resume.`,
  );
  process.exit(tracker.exceeded() ? 3 : 2);
}
