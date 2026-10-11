import { createHash, randomUUID } from 'node:crypto';
import {
  archiveIdFor,
  archiveStub,
  duplicateStub,
  supersededStub,
} from '../../../gc/gc-engine';

/**
 * Builds realistic, fake dashboard data for local development: agent
 * sessions over the last 30 days, with usage records, GC runs, decisions
 * and recalls. No prompt content is generated. Deterministic for a given
 * seed and end date (ids are random).
 */

type Price = { input: number; cachedInput?: number; output: number };

export type DemoProjectPlan = {
  name: string;
  upstream: 'openai' | 'gemini' | 'anthropic';
  gcMode: 'shadow' | 'on';
  model: string;
  price: Price;
  sessions: number;
  tools: string[];
  /** Agent session id prefix, for example "research". */
  label: string;
};

export type DemoRows = {
  sessions: Record<string, unknown>[];
  usage: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  recalls: Record<string, unknown>[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_CONTEXT = 8000;
const BATCH = 4000;

/** mulberry32: a small seeded random generator. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function costUsd(
  price: Price,
  input: number,
  cached: number,
  output: number,
): number {
  const cachedPrice = price.cachedInput ?? price.input;
  return (
    ((input - cached) * price.input +
      cached * cachedPrice +
      output * price.output) /
    1_000_000
  );
}

export function buildDemoRows(
  projectId: string,
  plan: DemoProjectPlan,
  seed: number,
  now: Date,
): DemoRows {
  const random = seededRandom(seed);
  const between = (min: number, max: number) =>
    Math.floor(min + random() * (max - min + 1));
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const rows: DemoRows = {
    sessions: [],
    usage: [],
    runs: [],
    decisions: [],
    recalls: [],
  };

  for (let s = 0; s < plan.sessions; s++) {
    const sessionId = randomUUID();
    const requests = between(6, 42);
    // Spread sessions over the last 30 days, a few minutes per request.
    let at =
      now.getTime() - between(1, 29) * DAY_MS - between(0, 20) * 3_600_000;
    const firstSeenAt = new Date(at);
    let context = between(2500, 5000);
    let processed = 0;
    let decisionCount = 0;
    let position = 6;

    for (let r = 0; r < requests; r++) {
      at += between(20, 240) * 1000;
      context += between(1200, 4200);
      const before = context;
      const ran = before > MIN_CONTEXT && before - processed > BATCH;
      let newDecisions = 0;
      if (ran) {
        processed = before;
        newDecisions = between(1, 5);
      }
      decisionCount += newDecisions;
      // Longer sessions carry more duplicate and stale tool output.
      const reduction =
        before > MIN_CONTEXT
          ? Math.min(0.72, 0.25 + (before - MIN_CONTEXT) / 90_000)
          : 0;
      const after = Math.round(
        before * (1 - reduction * (0.9 + random() * 0.2)),
      );
      const applied = plan.gcMode === 'on' && after < before;
      const sent = applied ? after : before;
      const output = between(120, 900);
      const cached = Math.round(sent * (0.45 + random() * 0.4));
      const recall = applied && random() < 0.05;
      const usageId = randomUUID();
      const createdAt = new Date(at);

      rows.usage.push({
        id: usageId,
        projectId,
        agentSessionId: sessionId,
        upstream: plan.upstream,
        model: plan.model,
        inputTokens: sent + (recall ? sent + 900 : 0),
        outputTokens: output,
        cachedInputTokens: cached,
        cacheWriteInputTokens: null,
        costUsd: Number(
          costUsd(
            plan.price,
            sent + (recall ? sent + 900 : 0),
            cached,
            output,
          ).toFixed(6),
        ),
        latencyMs: between(700, 9000),
        status: random() < 0.01 ? 429 : 200,
        streamed: random() < 0.6,
        upstreamCalls: recall ? 2 : 1,
        createdAt,
      });
      const runId = randomUUID();
      rows.runs.push({
        id: runId,
        projectId,
        agentSessionId: sessionId,
        usageRecordId: usageId,
        mode: plan.gcMode,
        ran,
        applied,
        failed: false,
        error: null,
        tokensBefore: before,
        tokensAfter: after,
        decisionCount,
        newDecisionCount: newDecisions,
        durationMs: between(4, 60),
        createdAt,
      });

      for (let d = 0; d < newDecisions; d++) {
        const roll = random();
        const reason =
          roll < 0.45
            ? 'duplicate'
            : roll < 0.75
              ? 'superseded'
              : 'stale_large';
        const toolName = pick(plan.tools);
        const tokensBefore =
          reason === 'stale_large' ? between(1600, 6000) : between(300, 2500);
        const hash = createHash('sha256').update(`${runId}:${d}`).digest('hex');
        const archiveId = reason === 'stale_large' ? archiveIdFor(hash) : null;
        const replacement =
          reason === 'duplicate'
            ? duplicateStub(toolName)
            : reason === 'superseded'
              ? supersededStub(toolName)
              : archiveStub(toolName, tokensBefore, archiveId!);
        position += between(2, 6);
        rows.decisions.push({
          gcRunId: runId,
          agentSessionId: sessionId,
          itemKey: `call:demo_${position}:${hash}`,
          position,
          toolCallId: `demo_${position}`,
          toolName,
          contentHash: hash,
          decision: reason === 'stale_large' ? 'archive' : 'drop',
          reason,
          detail:
            reason === 'stale_large'
              ? `${tokensBefore} tokens, ${between(7, 15)} turns old`
              : reason === 'duplicate'
                ? `same content as the tool result at position ${position + between(10, 40)}`
                : `same tool and arguments called again at position ${position + between(10, 40)}`,
          tokensBefore,
          tokensAfter: Math.round(replacement.length / 4),
          replacement,
          archiveId,
          createdAt,
        });
      }

      if (recall) {
        rows.recalls.push({
          projectId,
          agentSessionId: sessionId,
          usageRecordId: usageId,
          archiveId: archiveIdFor(
            createHash('sha256').update(usageId).digest('hex'),
          ),
          found: random() < 0.9,
          refused: false,
          tokensRestored: between(1600, 5000),
          createdAt,
        });
      }
    }

    rows.sessions.push({
      id: sessionId,
      projectId,
      externalId: `${plan.label}-${firstSeenAt.toISOString().slice(0, 10)}-${s.toString(16).padStart(3, '0')}`,
      idSource: 'header',
      provider: plan.upstream,
      model: plan.model,
      firstSeenAt,
      lastSeenAt: new Date(at),
      requestCount: requests,
      gcProcessedPosition: processed ? position : 0,
    });
  }
  return rows;
}
