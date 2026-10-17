import {
  diffSideEffects,
  latencyOverhead,
  mean,
  percentile,
  reduction,
  significance,
  stdev,
  type Significance,
  type SideEffectIssue,
} from './metrics.js';
import {
  PARSIM_ARMS,
  type Arm,
  type ArmRunResult,
  type BenchResults,
} from './types.js';

/**
 * The benchmark report: markdown (with the headline), a JSON file with all
 * raw numbers, and an SVG chart of task success against net cost. All of
 * it is generated from the results; nothing is edited by hand.
 */

export type ArmSummary = {
  arm: Arm;
  runs: number;
  /** Success rate per run (0 to 1). */
  successByRun: number[];
  success: { mean: number; sd: number };
  judgeSuccess: { mean: number; sd: number } | null;
  successVsFull: Significance | null;
  byType: Record<string, { mean: number; tasks: number }>;
  tokens: { input: number; output: number; cached: number };
  costs: { raw: number; net: number; cacheAdjusted: number };
  netCostByRun: number[];
  netVsFull: number | null;
  recalls: number;
  recallHits: number | null;
  latency: { p50: number; p95: number };
  /** Total rate-limit waits per run (ms); null if not recorded apart. */
  waitedMs: number | null;
  overheadVsFull: { p50: number; p95: number } | null;
  wallTimeMs: number;
  sideEffects: Record<SideEffectIssue['kind'], number> | null;
  issues: (SideEffectIssue & { run: number })[];
};

const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
/** "37.5% lower", or "0.5% higher" for a negative reduction. */
export const lowerOrHigher = (fraction: number) =>
  fraction >= 0 ? `${pct(fraction)} lower` : `${pct(-fraction)} higher`;
const usd = (value: number) => `$${value.toFixed(value < 0.01 ? 5 : 4)}`;
const int = (value: number) => Math.round(value).toLocaleString('en-US');

function successRate(result: ArmRunResult, judge = false): number {
  if (!result.tasks.length) return 0;
  const passed = result.tasks.filter((t) =>
    judge ? t.judge?.passed : t.passed,
  ).length;
  return passed / result.tasks.length;
}

export function summarizeArms(bench: BenchResults): ArmSummary[] {
  const byArm = (arm: Arm) => bench.results.filter((r) => r.arm === arm);
  const fullRuns = byArm('full');
  const fullSuccess = fullRuns.map((r) => successRate(r));
  const fullLatency = fullRuns.flatMap((r) =>
    r.stepRecords.map((s) => s.latencyMs),
  );
  const fullNet = mean(fullRuns.map((r) => r.costs.netUsd));
  return bench.config.arms
    .filter((arm) => byArm(arm).length)
    .map((arm): ArmSummary => {
      const runs = byArm(arm);
      const successByRun = runs.map((r) => successRate(r));
      const judged = runs.every((r) => r.tasks.every((t) => t.judge));
      const judgeByRun = runs.map((r) => successRate(r, true));
      const types = [
        ...new Set(runs.flatMap((r) => r.tasks.map((t) => t.type))),
      ];
      const byType = Object.fromEntries(
        types.map((type) => {
          const rates = runs.map((r) => {
            const tasks = r.tasks.filter((t) => t.type === type);
            return tasks.filter((t) => t.passed).length / tasks.length;
          });
          const tasks = runs[0]!.tasks.filter((t) => t.type === type).length;
          return [type, { mean: mean(rates), tasks }];
        }),
      );
      const latencies = runs.flatMap((r) =>
        r.stepRecords.map((s) => s.latencyMs),
      );
      const hits = runs.flatMap((r) => r.tasks.map((t) => t.recallHits));
      const issues =
        arm === 'full' || !fullRuns.length
          ? []
          : runs.flatMap((r) => {
              const full = fullRuns.find((f) => f.run === r.run);
              return full
                ? diffSideEffects(full.sideEffects, r.sideEffects).map((i) => ({
                    ...i,
                    run: r.run,
                  }))
                : [];
            });
      const net = mean(runs.map((r) => r.costs.netUsd));
      return {
        arm,
        runs: runs.length,
        successByRun,
        success: { mean: mean(successByRun), sd: stdev(successByRun) },
        judgeSuccess: judged
          ? { mean: mean(judgeByRun), sd: stdev(judgeByRun) }
          : null,
        successVsFull:
          arm === 'full' || !fullRuns.length
            ? null
            : significance(successByRun, fullSuccess),
        byType,
        tokens: {
          input: mean(runs.map((r) => r.usage.inputTokens)),
          output: mean(runs.map((r) => r.usage.outputTokens)),
          cached: mean(runs.map((r) => r.usage.cachedInputTokens)),
        },
        costs: {
          raw: mean(runs.map((r) => r.costs.rawUsd)),
          net,
          cacheAdjusted: mean(runs.map((r) => r.costs.cacheAdjustedUsd)),
        },
        netCostByRun: runs.map((r) => r.costs.netUsd),
        netVsFull:
          arm === 'full' || !fullRuns.length ? null : reduction(fullNet, net),
        recalls: mean(
          runs.map((r) => r.tasks.reduce((s, t) => s + t.recalls, 0)),
        ),
        recallHits: hits.some((h) => h === null)
          ? null
          : mean(
              runs.map((r) =>
                r.tasks.reduce((s, t) => s + (t.recallHits ?? 0), 0),
              ),
            ),
        latency: {
          p50: percentile(latencies, 50),
          p95: percentile(latencies, 95),
        },
        waitedMs: runs.every((r) =>
          r.stepRecords.every((s) => s.waitedMs !== undefined),
        )
          ? mean(
              runs.map((r) =>
                r.stepRecords.reduce((sum, s) => sum + (s.waitedMs ?? 0), 0),
              ),
            )
          : null,
        overheadVsFull:
          PARSIM_ARMS.includes(arm) && fullLatency.length
            ? latencyOverhead(latencies, fullLatency)
            : null,
        wallTimeMs: mean(runs.map((r) => r.wallTimeMs)),
        sideEffects:
          arm === 'full' || !fullRuns.length
            ? null
            : {
                missing: issues.filter((i) => i.kind === 'missing').length,
                duplicated: issues.filter((i) => i.kind === 'duplicated')
                  .length,
                changed: issues.filter((i) => i.kind === 'changed').length,
                extra: issues.filter((i) => i.kind === 'extra').length,
              },
        issues,
      };
    });
}

/** The one-line headline, in the agreed form. */
export function headline(summaries: ArmSummary[]): string {
  const get = (arm: Arm) => summaries.find((s) => s.arm === arm);
  const full = get('full');
  const on = get('parsim-on');
  const truncate = get('truncate');
  if (!full || !on || !truncate) {
    return 'Headline needs the full, truncate and parsim-on arms.';
  }
  return `Parsim on: ${lowerOrHigher(on.netVsFull ?? 0)} net cost, success ${pct(on.success.mean)} vs ${pct(full.success.mean)} for full context. Truncation: ${lowerOrHigher(truncate.netVsFull ?? 0)} net cost, success ${pct(truncate.success.mean)}.`;
}

export const DEV_RUN_BANNER =
  "> **Development run, not for publishing.** It used a free-tier model; costs are at the model's list price.";

export type ReportFiles = {
  base: string;
  markdown: string;
  json: string;
  svg: string;
};

/** File names: <date>-<agent>-<provider>-<model>. */
export function reportFiles(bench: BenchResults): ReportFiles {
  const { config } = bench;
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-|-$/g, '');
  const base = `${config.startedAt.slice(0, 10)}-${config.agent}-${slug(config.provider)}-${slug(config.model)}${config.dryRun ? '-dry-run' : ''}`;
  return {
    base,
    markdown: `${base}.md`,
    json: `${base}.json`,
    svg: `${base}.svg`,
  };
}

export function renderSvg(summaries: ArmSummary[]): string {
  const width = 640;
  const height = 400;
  const pad = { left: 70, right: 30, top: 30, bottom: 60 };
  const maxCost = Math.max(...summaries.map((s) => s.costs.net), 1e-9) * 1.15;
  const x = (cost: number) =>
    pad.left + (cost / maxCost) * (width - pad.left - pad.right);
  const y = (success: number) =>
    height - pad.bottom - success * (height - pad.top - pad.bottom);
  const colors: Record<Arm, string> = {
    full: '#737373',
    truncate: '#4c78a8',
    summarize: '#72b7b2',
    'parsim-shadow': '#ff7700',
    'parsim-on': '#ff3b00',
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif" font-size="12">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#262626"/>`,
    `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#262626"/>`,
    ...ticks.map(
      (t) =>
        `<text x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end" fill="#525252">${t * 100}%</text>`,
    ),
    ...ticks.map(
      (t) =>
        `<text x="${x(t * maxCost)}" y="${height - pad.bottom + 18}" text-anchor="middle" fill="#525252">${usd(t * maxCost)}</text>`,
    ),
    `<text x="${(pad.left + width - pad.right) / 2}" y="${height - 15}" text-anchor="middle" fill="#262626">Net cost per run (USD)</text>`,
    `<text x="18" y="${(pad.top + height - pad.bottom) / 2}" text-anchor="middle" fill="#262626" transform="rotate(-90 18 ${(pad.top + height - pad.bottom) / 2})">Task success</text>`,
    ...summaries.flatMap((s) => [
      `<circle cx="${x(s.costs.net).toFixed(1)}" cy="${y(s.success.mean).toFixed(1)}" r="7" fill="${colors[s.arm]}"/>`,
      `<text x="${(x(s.costs.net) + 10).toFixed(1)}" y="${(y(s.success.mean) - 8).toFixed(1)}" fill="#262626">${s.arm}</text>`,
    ]),
    '</svg>',
  ];
  return `${lines.join('\n')}\n`;
}

export function renderJson(
  bench: BenchResults,
  summaries: ArmSummary[],
): string {
  return `${JSON.stringify({ ...bench, summaries }, null, 2)}\n`;
}

export function renderMarkdown(
  bench: BenchResults,
  summaries: ArmSummary[],
  files: ReportFiles,
): string {
  const { config } = bench;
  const complete = bench.finishedAt !== null;
  const types = [...new Set(summaries.flatMap((s) => Object.keys(s.byType)))];
  const significanceNote =
    config.runs < 2
      ? 'One run: there is no run-to-run spread, so no difference can be called significant.'
      : 'A difference counts as significant only when it is larger than the run-to-run spread (the larger standard deviation of the two arms).';
  const out = [
    `# Benchmark: ${config.agent} agent, ${config.provider} ${config.model}`,
    '',
    ...(config.freeTier ? [DEV_RUN_BANNER, ''] : []),
    ...(config.dryRun
      ? [
          '> **Dry run** against the scripted fake upstream: no real model was called. The numbers test the pipeline, not Parsim.',
          '',
        ]
      : []),
    ...(!complete
      ? [
          '> **Incomplete:** the run stopped before every arm finished (quota or budget). Continue it with `--resume`.',
          '',
        ]
      : []),
    `**${headline(summaries)}**`,
    '',
    `- Command: \`${config.command}\``,
    `- Model: ${config.provider} \`${config.model}\`; internal model (summaries${config.judge ? ', judge' : ''}): \`${config.internalModel}\``,
    `- Parsim: ${config.parsimVersion}, commit \`${config.gitCommit}\``,
    `- Run date: ${config.startedAt}${bench.finishedAt ? ` to ${bench.finishedAt}` : ''}`,
    `- Runs: ${config.runs}; tasks: the first ${config.taskCount} of the ${config.agent} agent; tools replay recordings; temperature 0`,
    `- Baselines: last N = ${config.truncateTurns} turns kept; summary refreshed every M = ${config.summaryEvery} turns`,
    `- Prices (USD per 1M tokens): model input ${config.prices.model.input}, cached input ${config.prices.model.cachedInput ?? config.prices.model.input}, output ${config.prices.model.output}. ${config.prices.note}`,
    '',
    '## Results by arm',
    '',
    '| Arm | Success | vs full | Input tokens | Output tokens | Cached | Raw cost | Net cost | Cache-adjusted | Net vs full | Recalls | Wall time |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summaries.map(
      (s) =>
        `| ${s.arm} | ${pct(s.success.mean)} ± ${pct(s.success.sd)} | ${s.successVsFull ?? '-'} | ${int(s.tokens.input)} | ${int(s.tokens.output)} | ${int(s.tokens.cached)} | ${usd(s.costs.raw)} | ${usd(s.costs.net)} | ${usd(s.costs.cacheAdjusted)} | ${s.netVsFull === null ? '-' : lowerOrHigher(s.netVsFull)} | ${s.recalls.toFixed(1)} | ${(s.wallTimeMs / 1000).toFixed(1)}s |`,
    ),
    '',
    ...(summaries.some((s) => s.judgeSuccess)
      ? [
          'LLM judge (task checklists):',
          '',
          ...summaries.map(
            (s) =>
              `- ${s.arm}: ${s.judgeSuccess ? `${pct(s.judgeSuccess.mean)} ± ${pct(s.judgeSuccess.sd)}` : '-'}`,
          ),
          '',
        ]
      : []),
    '## Success by task type',
    '',
    `| Arm | ${types.join(' | ')} |`,
    `| --- | ${types.map(() => '---').join(' | ')} |`,
    ...summaries.map(
      (s) =>
        `| ${s.arm} | ${types.map((t) => (s.byType[t] ? `${pct(s.byType[t].mean)} (${s.byType[t].tasks} task${s.byType[t].tasks === 1 ? '' : 's'})` : '-')).join(' | ')} |`,
    ),
    '',
    '## Latency',
    '',
    '| Arm | p50 per step | p95 per step | Overhead vs full (p50 / p95) | Rate-limit waits |',
    '| --- | --- | --- | --- | --- |',
    ...summaries.map(
      (s) =>
        `| ${s.arm} | ${int(s.latency.p50)} ms | ${int(s.latency.p95)} ms | ${s.overheadVsFull ? `${int(s.overheadVsFull.p50)} ms / ${int(s.overheadVsFull.p95)} ms` : '-'} | ${s.waitedMs === null ? 'included above' : `${(s.waitedMs / 1000).toFixed(1)}s`} |`,
    ),
    '',
    ...(summaries.some((s) => s.waitedMs === null)
      ? [
          "> In this run the time per step includes the waits for the provider's rate limits (they were not recorded apart), so the latency and overhead above mostly measure those waits, not Parsim.",
          '',
        ]
      : []),
    '## Recalls',
    '',
    ...summaries
      .filter((s) => PARSIM_ARMS.includes(s.arm))
      .map(
        (s) =>
          `- ${s.arm}: ${s.recalls.toFixed(1)} recalls per run; ${s.recallHits === null ? 'recall success unknown (the project does not store content)' : `${s.recallHits.toFixed(1)} brought back a fact the task needed`}`,
      ),
    '',
    '## Side-effect safety',
    '',
    "Every arm's side-effect calls against the full arm in the same run: a call missing, made twice, made with a different value (status or answer), or extra.",
    '',
    '| Arm | Missing | Duplicated | Changed | Extra |',
    '| --- | --- | --- | --- | --- |',
    ...summaries
      .filter((s) => s.sideEffects)
      .map(
        (s) =>
          `| ${s.arm} | ${s.sideEffects!.missing} | ${s.sideEffects!.duplicated} | ${s.sideEffects!.changed} | ${s.sideEffects!.extra} |`,
      ),
    '',
    ...summaries.flatMap((s) =>
      s.issues.length
        ? [
            `${s.arm}:`,
            ...s.issues.map(
              (i) =>
                `- run ${i.run}: ${i.kind} ${i.tool} for ${i.target}${i.kind === 'changed' ? ` (${i.expected} -> ${i.actual})` : ''}`,
            ),
            '',
          ]
        : [],
    ),
    '## Method',
    '',
    '- **Arms:** full context without Parsim; naive truncation (system prompt, first user goal and the last N turns); naive summarization (one internal-model summary of everything older than N turns, refreshed every M turns); Parsim in shadow mode; Parsim on. All arms run the same tasks with the same model, temperature 0 and the same tool recordings.',
    "- **Success:** exact checks of each task's expected answer against the side-effect log (`save_report`, `update_ticket` and `send_reply`). With `--judge`, the internal model also grades each task against its checklist.",
    `- **Significance:** ${significanceNote}`,
    "- **Cost:** raw prices every input token at the input price; net adds what Parsim sent upstream for recalls, Parsim's compression summaries and the summarize baseline's summaries; cache-adjusted prices cached input tokens at the cached input price.",
    "- **Latency:** time per model call, as the agent saw it. Overhead is the Parsim arm's p50 and p95 minus the full arm's.",
    '',
    `![Task success against net cost](${files.svg})`,
    '',
    `Raw numbers: [${files.json}](${files.json})`,
    '',
  ];
  return out.join('\n');
}
