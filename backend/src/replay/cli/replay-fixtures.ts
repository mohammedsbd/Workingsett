import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { CompressionConfig } from '../../compression/config/compression-config.type';
import compressionConfig from '../../compression/config/compression.config';
import { SummarizerTarget } from '../../compression/summarizer';
import { TokenCounter } from '../../context/token-counter';
import { GcConfig } from '../../gc/gc-config';
import gcConfig from '../../proxy/config/gc.config';
import { ProxyConfig } from '../../proxy/config/proxy-config.type';
import proxyConfig from '../../proxy/config/proxy.config';
import { Upstream } from '../../proxy/providers/provider-adapter';
import { parseModelPriceTable } from '../../usage-records/pricing/model-pricing';
import { ReplayConfig } from '../config/replay-config.type';
import replayConfig from '../config/replay.config';
import { UnknownPriceError } from '../cost';
import {
  FixturePoint,
  FixtureReplayer,
  FixtureTarget,
  fixturePoints,
  listFixtures,
  loadFixture,
} from '../fixtures/fixture-replay';

const USAGE = `Replays the fixture sessions (test/fixtures/conversations) against a real
model: each request point the GC changed is sent as recorded and as the GC
made it, and the answers are compared. Shows the cost estimate first.

  npm run replay:fixtures -- --model <model> [options]

Options:
  --model <model>     Model to replay with (required).
  --provider <name>   gemini (OpenAI-compatible endpoint) or openai.
                      Default: PARSIM_INTERNAL_PROVIDER.
  --fixtures <ids>    Comma-separated fixture ids. Default: all.
  --points <n>        Request points per fixture. Default: REPLAY_DEFAULT_POINTS.
  --budget <usd>      Hard budget for the whole run. Default: REPLAY_DEFAULT_BUDGET_USD.
  --dry-run           Show the estimate and stop.
  --yes               Start without asking.
  --out <file>        Also write the report as JSON.

The provider key comes from .env (GEMINI_API_KEY or OPENAI_API_KEY). The
judge is Parsim's internal model (REPLAY_JUDGE_MODEL or PARSIM_INTERNAL_MODEL).
Fixtures are synthetic, so no real data is sent.`;

const KEYS: Record<Upstream, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

const usd = (value: number) => `$${value.toFixed(4)}`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      model: { type: 'string' },
      provider: { type: 'string' },
      fixtures: { type: 'string' },
      points: { type: 'string' },
      budget: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      out: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.model) fail(USAGE);

  // The config factories are synchronous (they read process.env).
  const proxy = proxyConfig() as ProxyConfig;
  const replay = replayConfig() as ReplayConfig;
  const internal = (compressionConfig() as CompressionConfig).internal;
  const provider = (values.provider ?? internal.provider) as Upstream;
  if (provider !== 'gemini' && provider !== 'openai') {
    fail(
      '--provider must be gemini or openai (the fixtures are OpenAI chat requests).',
    );
  }
  const apiKey = process.env[KEYS[provider]];
  if (!apiKey) fail(`${KEYS[provider]} is not set in .env.`);
  const target: FixtureTarget = {
    provider,
    model: values.model,
    apiKey,
    url:
      provider === 'gemini'
        ? `${proxy.geminiBaseUrl}/chat/completions`
        : `${proxy.openaiBaseUrl}/v1/chat/completions`,
  };
  const judgeModel = replay.judgeModel || internal.model;
  if (!judgeModel || !internal.apiKey) {
    fail(
      'The judge needs PARSIM_INTERNAL_MODEL (or REPLAY_JUDGE_MODEL) and the internal provider key.',
    );
  }
  const judgeBase: Record<Upstream, string> = {
    openai: proxy.openaiBaseUrl,
    gemini: proxy.geminiNativeBaseUrl,
    anthropic: proxy.anthropicBaseUrl,
  };
  const judge: SummarizerTarget = {
    provider: internal.provider,
    model: judgeModel,
    baseUrl: internal.baseUrl ?? judgeBase[internal.provider],
    apiKey: internal.apiKey,
  };

  const ids =
    values.fixtures?.split(',').map((s) => s.trim()) ?? listFixtures();
  const perFixture = values.points
    ? parseInt(values.points, 10)
    : replay.defaultPoints;
  const budgetUsd = values.budget
    ? Number(values.budget)
    : replay.defaultBudgetUsd;
  if (!(budgetUsd > 0)) fail('--budget must be a positive number of USD.');

  const tokens = new TokenCounter();
  const gc = gcConfig() as GcConfig;
  const points: FixturePoint[] = ids.flatMap((id) =>
    fixturePoints(loadFixture(id), {
      model: target.model,
      gc,
      count: (text, images) =>
        tokens.count(text, images, { upstream: provider, model: target.model })
          .tokens,
      max: perFixture,
    }),
  );
  if (!points.length)
    fail('The GC changes no request of these fixtures: nothing to replay.');

  const replayer = new FixtureReplayer({
    target,
    judge,
    prices: parseModelPriceTable(
      JSON.parse(readFileSync(proxy.modelPricesPath, 'utf8')) as unknown,
    ),
    passScore: replay.passScore,
    recallMax: proxy.recallMaxPerRequest,
    outputReserveTokens: replay.outputReserveTokens,
  });
  let estimate;
  try {
    estimate = replayer.estimate(points, replay.defaultOutputTokens);
  } catch (error) {
    if (error instanceof UnknownPriceError) fail(error.message);
    throw error;
  }

  console.log(
    `Replay of ${points.length} request points with ${provider} ${target.model}, judged by ${judge.provider} ${judge.model}\n`,
  );
  console.log(
    'fixture                      request  original tok  gc tok   estimate',
  );
  estimate.points.forEach((p, i) => {
    console.log(
      `${points[i].fixture.padEnd(28)} ${String(p.requestNumber).padStart(7)}  ${String(p.originalInputTokens).padStart(12)}  ${String(p.gcInputTokens).padStart(6)}   ${usd(p.originalUsd + p.gcUsd + p.judgeUsd)}`,
    );
  });
  console.log(
    `\nEstimated cost: ${usd(estimate.totalUsd)} (budget ${usd(budgetUsd)}, a hard limit)`,
  );
  if (estimate.totalUsd > budgetUsd) {
    console.log(
      'The estimate is above the budget: the replay will stop early.',
    );
  }
  if (values['dry-run']) return;
  if (!values.yes && !(await confirm('Start the replay? (y/N) '))) {
    console.log('Not started.');
    return;
  }

  const report = await replayer.run(points, budgetUsd, (point, outcome) => {
    const verdict =
      outcome.status === 'failed'
        ? `failed (${outcome.error})`
        : outcome.exactMatch
          ? 'identical'
          : `judge ${outcome.judgeScore ?? '-'}: ${outcome.judgeReason ?? ''}`;
    console.log(`${point.fixture} #${point.requestNumber}: ${verdict}`);
  });

  const rate = report.agreement.rate;
  console.log(
    `\nAgreement: ${rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`} (${report.agreement.agreed} of ${report.agreement.judged}, ${report.agreement.exactMatches} identical)`,
  );
  console.log(
    `Original: ${report.original.inputTokens} input, ${report.original.outputTokens} output tokens, ${usd(report.original.costUsd)}`,
  );
  console.log(
    `GC'd:     ${report.gc.inputTokens} input, ${report.gc.outputTokens} output tokens, ${usd(report.gc.costUsd)}`,
  );
  console.log(
    `Judge:    ${usd(report.judgeCostUsd)}. Total spent: ${usd(report.spentUsd)}`,
  );
  if (report.stopped) console.log(`Stopped early: ${report.stopped}`);
  if (values.out) {
    writeFileSync(values.out, JSON.stringify(report, null, 2));
    console.log(`Report written to ${values.out}`);
  }
}

main().catch((error: unknown) => {
  console.error(`Replay failed: ${(error as Error)?.message ?? String(error)}`);
  process.exit(1);
});
