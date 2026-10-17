import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  MAX_OUTPUT_TOKENS as JUDGE_MAX_OUTPUT_TOKENS,
  summarize,
  SummarizerError,
  SummarizerTarget,
} from '../compression/summarizer';
import { internalTarget, projectTarget } from '../compression/internal-target';
import { AllConfigType } from '../config/config.type';
import { checkCustomUpstream } from '../proxy/custom-upstream';
import { extractContextItems } from '../context/context-items';
import { TokenCounter } from '../context/token-counter';
import { JobsService } from '../jobs/jobs.service';
import { Project } from '../projects/domain/project';
import { ProjectsService } from '../projects/projects.service';
import {
  PROVIDER_ADAPTERS,
  PROXY_OPERATIONS,
  ProviderAdapter,
  ProxyApi,
  ProxyOperation,
  Upstream,
} from '../proxy/providers/provider-adapter';
import { RecallService } from '../recall/recall.service';
import { ReplayResult } from '../replay-results/domain/replay-result';
import { ReplayResultRepository } from '../replay-results/infrastructure/persistence/replay-result.repository';
import { Replay } from '../replays/domain/replay';
import { ReplayRepository } from '../replays/infrastructure/persistence/replay.repository';
import { RequestSnapshot } from '../request-snapshots/domain/request-snapshot';
import { RequestSnapshotsService } from '../request-snapshots/request-snapshots.service';
import { ModelPricingService } from '../usage-records/pricing/model-pricing.service';
import { TokenUsage } from '../usage-records/domain/token-usage';
import { UsageRecordsService } from '../usage-records/usage-records.service';
import { BudgetExceededError, ReplayBudget } from './budget';
import { agreementRate } from './compare';
import {
  estimateReplay,
  PointTokens,
  PriceFn,
  roundUsd,
  spreadPoints,
  UnknownPriceError,
} from './cost';
import { StartReplayDto } from './dto/start-replay.dto';
import { JUDGE_INSTRUCTIONS } from './judge';
import { maxOutputTokens } from './replay-request';
import { ReplayCall, ReplayPort, replayPoint } from './replay-runner';
import {
  ReplayCandidate,
  ReplayEstimateView,
  ReplayOptions,
  ReplayPointView,
  ReplayReport,
  ReplaySummary,
  VariantView,
  VersionTotals,
} from './replay.types';

export const REPLAY_QUEUE = 'replay-run';

type ReplayJob = { replayId: string };

/** The non-streamed operation each client API is replayed with. */
const OPERATION_FOR_API: Record<ProxyApi, ProxyOperation> = {
  'openai-chat': PROXY_OPERATIONS.chatCompletions,
  'anthropic-messages': PROXY_OPERATIONS.messages,
  'gemini-native': PROXY_OPERATIONS.generateContent,
};

/** A replay cannot go on; the message never holds content. */
class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

type JudgeInfo = {
  keySource: Project['replayJudgeKeySource'];
  provider: Upstream;
  model: string;
};

type Plan = {
  view: ReplayEstimateView;
  judge: JudgeInfo;
};

/**
 * Replay of recorded agent sessions (see docs/replay.md).
 *
 * - `options` and `estimate` tell the session page what can be replayed
 *   and what it would cost, before anything is sent.
 * - `start` stores a queued replay and sends a pg-boss job; the worker
 *   replays each request point twice with the project's own key (as
 *   recorded and as the GC made it), has the judge compare the answers,
 *   and stops before any call that could pass the replay's budget.
 * - `report` returns the agreement rate, both versions' tokens and cost,
 *   and, when the project stores content, the answers side by side.
 *
 * Content is never logged.
 */
@Injectable()
export class ReplayService implements OnModuleInit {
  private readonly logger = new Logger(ReplayService.name);
  private readonly tokens = new TokenCounter();
  private readonly adapters: Map<string, ProviderAdapter>;

  constructor(
    @Inject(PROVIDER_ADAPTERS) adapters: ProviderAdapter[],
    private readonly replays: ReplayRepository,
    private readonly results: ReplayResultRepository,
    private readonly snapshots: RequestSnapshotsService,
    private readonly projects: ProjectsService,
    private readonly usageRecords: UsageRecordsService,
    private readonly pricing: ModelPricingService,
    private readonly recall: RecallService,
    private readonly jobs: JobsService,
    @InjectDataSource() private readonly db: DataSource,
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    this.adapters = new Map(adapters.map((a) => [`${a.api}:${a.upstream}`, a]));
  }

  private get config() {
    return this.configService.getOrThrow('replay', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    // Replays spend money: a failed run is never retried on its own.
    await this.jobs.createQueue(REPLAY_QUEUE, {
      retryLimit: 0,
      expireInSeconds: 4 * 60 * 60,
    });
    if (this.config.worker) {
      await this.jobs.work<ReplayJob>(
        REPLAY_QUEUE,
        { pollingIntervalSeconds: this.config.pollSeconds },
        (job) => this.run(job.data.replayId),
      );
    }
  }

  async options(
    ownerId: number,
    projectId: string,
    sessionId: string,
  ): Promise<ReplayOptions> {
    const project = await this.owned(ownerId, projectId, sessionId);
    const candidates = toCandidates(
      await this.snapshots.findBySession(sessionId),
    );
    return {
      blockedReason: this.blockedReason(project, candidates),
      candidates,
      defaultRequestNumbers: this.defaultPoints(candidates),
      defaultBudgetUsd: this.config.defaultBudgetUsd,
      maxBudgetUsd: this.config.maxBudgetUsd,
      maxPoints: this.config.maxPoints,
      judge: this.judgeInfo(project),
    };
  }

  async estimate(
    ownerId: number,
    projectId: string,
    sessionId: string,
    dto: StartReplayDto,
  ): Promise<ReplayEstimateView> {
    const project = await this.owned(ownerId, projectId, sessionId);
    return (await this.plan(project, sessionId, dto)).view;
  }

  /** Stores a queued replay and sends its job. */
  async start(
    ownerId: number,
    projectId: string,
    sessionId: string,
    dto: StartReplayDto,
  ): Promise<ReplaySummary> {
    const project = await this.owned(ownerId, projectId, sessionId);
    const { view, judge } = await this.plan(project, sessionId, dto);
    const replay = await this.replays.create({
      projectId: project.id,
      agentSessionId: sessionId,
      requestNumbers: view.requestNumbers,
      budgetUsd: view.budgetUsd,
      estimatedCostUsd: view.totalUsd,
      judgeKeySource: judge.keySource,
      judgeProvider: judge.provider,
      judgeModel: judge.model,
    });
    await this.jobs.send(REPLAY_QUEUE, { replayId: replay.id });
    this.logger.log(
      `replay queued id=${replay.id} project=${project.id} session=${sessionId} points=${view.requestNumbers.length} estimateUsd=${view.totalUsd} budgetUsd=${view.budgetUsd}`,
    );
    return toSummary(replay);
  }

  async list(
    ownerId: number,
    projectId: string,
    sessionId: string,
  ): Promise<ReplaySummary[]> {
    await this.owned(ownerId, projectId, sessionId);
    return (await this.replays.findBySession(sessionId)).map(toSummary);
  }

  async report(
    ownerId: number,
    projectId: string,
    sessionId: string,
    replayId: string,
  ): Promise<ReplayReport> {
    const project = await this.owned(ownerId, projectId, sessionId);
    const replay = await this.replays.findById(replayId);
    if (!replay || replay.agentSessionId !== sessionId) {
      throw new NotFoundException();
    }
    const results = await this.results.findByReplay(replay.id);
    return buildReport(replay, results, this.projects.storesContent(project));
  }

  /** The replay job. Never throws: the outcome is stored on the replay. */
  async run(replayId: string): Promise<void> {
    if (!(await this.replays.start(replayId))) return;
    const replay = (await this.replays.findById(replayId))!;
    const budget = new ReplayBudget(replay.budgetUsd, replay.spentUsd);
    let done = replay.pointsDone;
    const progress = () =>
      this.replays.progress(replayId, {
        pointsDone: done,
        spentUsd: roundUsd(budget.spentUsd),
      });
    try {
      const project = await this.projects.findById(replay.projectId);
      if (!project) throw new ReplayError('the project no longer exists');
      const providerKey = this.projects.storedProviderKey(project);
      if (!providerKey) {
        throw new ReplayError('the project has no stored provider key');
      }
      const judge = this.judgeTarget(project);
      for (const requestNumber of replay.requestNumbers.slice(done)) {
        await this.replayOne(
          replay,
          project,
          providerKey,
          judge,
          budget,
          requestNumber,
        );
        done += 1;
        await progress();
      }
      await this.replays.finish(replayId, 'completed', null);
      this.logger.log(
        `replay completed id=${replayId} points=${done} spentUsd=${roundUsd(budget.spentUsd)}`,
      );
    } catch (error) {
      await progress();
      if (error instanceof BudgetExceededError) {
        await this.replays.finish(replayId, 'budget_exceeded', error.message);
        this.logger.warn(
          `replay stopped by its budget id=${replayId} points=${done} spentUsd=${roundUsd(budget.spentUsd)}`,
        );
        return;
      }
      const reason =
        error instanceof ReplayError
          ? error.message
          : `${(error as Error)?.name ?? 'Error'} while replaying`;
      await this.replays.finish(replayId, 'failed', reason);
      this.logger.error(`replay failed id=${replayId} reason=${reason}`);
    }
  }

  private async replayOne(
    replay: Replay,
    project: Project,
    providerKey: string,
    judge: SummarizerTarget,
    budget: ReplayBudget,
    requestNumber: number,
  ): Promise<void> {
    const loaded = await this.snapshots.load(
      project.id,
      replay.agentSessionId,
      requestNumber,
    );
    const adapter = loaded && this.adapterFor(loaded.snapshot.api, project);
    if (!loaded || !adapter) {
      await this.results.insert(
        failedPoint(
          replay.id,
          requestNumber,
          loaded
            ? `the project's upstream cannot serve ${loaded.snapshot.api} requests`
            : 'the recorded request is missing',
        ),
      );
      return;
    }
    const port = this.port(
      replay,
      project,
      loaded.snapshot,
      adapter,
      providerKey,
      judge,
    );
    const outcome = await replayPoint(port, budget, {
      requestNumber,
      original: loaded.original,
      gc: loaded.gc,
      context: this.judgeContext(
        adapter,
        loaded.original,
        loaded.snapshot.model,
      ),
    });
    await this.results.insert({ replayId: replay.id, ...outcome });
  }

  /** Real calls for one request point: the project's key, Parsim's judge. */
  private port(
    replay: Replay,
    project: Project,
    snapshot: RequestSnapshot,
    adapter: ProviderAdapter,
    providerKey: string,
    judge: SummarizerTarget,
  ): ReplayPort {
    const model = snapshot.model;
    const proxy = this.configService.getOrThrow('proxy', { infer: true });
    const priceOf = (m: string) => {
      const price = this.priceFn(m);
      return (input: number, output: number) =>
        price?.(input, output) ?? Number.POSITIVE_INFINITY;
    };
    const replayPrice = priceOf(model);
    const judgePrice = priceOf(judge.model);
    const ids = {
      projectId: project.id,
      agentSessionId: replay.agentSessionId,
    };
    const upstreamBaseUrl = this.upstreamBaseUrl(project);
    return {
      api: snapshot.api,
      recallMax: proxy.recallMaxPerRequest,
      passScore: this.config.passScore,
      send: (body) =>
        this.send(
          ids,
          adapter,
          model,
          providerKey,
          body,
          proxy.upstreamTimeoutMs,
          upstreamBaseUrl,
        ),
      // An unknown price makes the call too expensive for any budget.
      maxCallCostUsd: (body) =>
        replayPrice(
          this.inputTokens(adapter, body, model),
          maxOutputTokens(snapshot.api, body) ??
            this.config.outputReserveTokens,
        ),
      recall: async (round) =>
        (await this.recall.resolve(project.id, round)).results,
      judge: (prompt) => this.callJudge(ids, judge, prompt),
      maxJudgeCostUsd: (prompt) =>
        judgePrice(
          this.count(`${JUDGE_INSTRUCTIONS}\n${prompt}`, judge),
          JUDGE_MAX_OUTPUT_TOKENS,
        ),
    };
  }

  /** One replayed call, recorded as a 'replay' usage record. */
  private async send(
    ids: { projectId: string; agentSessionId: string },
    adapter: ProviderAdapter,
    model: string,
    providerKey: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    upstreamBaseUrl: string | undefined,
  ): Promise<ReplayCall> {
    const prepared = adapter.prepare({
      operation: OPERATION_FOR_API[adapter.api],
      rawBody: Buffer.from(JSON.stringify(body)),
      info: { model, stream: false, hasStreamOptions: false },
      providerKey,
      clientHeaders: {},
      query: {},
      upstreamBaseUrl,
    });
    const started = performance.now();
    const response = await fetch(prepared.url, {
      method: 'POST',
      headers: prepared.headers,
      body: new Uint8Array(prepared.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = undefined;
    }
    const usage = response.ok ? adapter.usageFromResponse(json) : null;
    const record = await this.usageRecords.record({
      ...ids,
      upstream: adapter.upstream,
      model,
      usage,
      latencyMs: Math.round(performance.now() - started),
      status: response.status,
      streamed: false,
      kind: 'replay',
    });
    return {
      status: response.status,
      response: json,
      usage,
      // Failed calls are not billed; a success without usage has an unknown cost.
      costUsd: response.ok ? record.costUsd : 0,
    };
  }

  private async callJudge(
    ids: { projectId: string; agentSessionId: string },
    judge: SummarizerTarget,
    prompt: string,
  ): Promise<{ text: string; costUsd: number | null }> {
    const started = performance.now();
    const result = await summarize(judge, JUDGE_INSTRUCTIONS, prompt);
    const record = await this.usageRecords.record({
      ...ids,
      upstream: judge.provider,
      model: judge.model,
      usage: result.usage,
      latencyMs: Math.round(performance.now() - started),
      status: 200,
      streamed: false,
      kind: 'replay_judge',
    });
    return { text: result.text, costUsd: record.costUsd };
  }

  /** The request points, budget and cost of a replay, before it starts. */
  private async plan(
    project: Project,
    sessionId: string,
    dto: StartReplayDto,
  ): Promise<Plan> {
    const snapshots = await this.snapshots.findBySession(sessionId);
    const candidates = toCandidates(snapshots);
    const blocked = this.blockedReason(project, candidates);
    if (blocked) throw new BadRequestException(blocked);

    const requestNumbers = dto.requestNumbers
      ? [...new Set(dto.requestNumbers)].sort((a, b) => a - b)
      : this.defaultPoints(candidates);
    if (requestNumbers.length > this.config.maxPoints) {
      throw new BadRequestException(
        `A replay can have at most ${this.config.maxPoints} request points`,
      );
    }
    const byNumber = new Map(snapshots.map((s) => [s.requestNumber, s]));
    const missing = requestNumbers.filter((n) => !byNumber.has(n));
    if (missing.length) {
      throw new BadRequestException(
        `No recorded request ${missing.join(', ')} in this session`,
      );
    }
    const budgetUsd = dto.budgetUsd ?? this.config.defaultBudgetUsd;
    if (budgetUsd > this.config.maxBudgetUsd) {
      throw new BadRequestException(
        `The budget can be at most $${this.config.maxBudgetUsd}`,
      );
    }

    const outputs = await this.recordedOutputs(
      requestNumbers.map((n) => byNumber.get(n)!.usageRecordId),
    );
    const points: PointTokens[] = [];
    for (const requestNumber of requestNumbers) {
      const loaded = await this.snapshots.load(
        project.id,
        sessionId,
        requestNumber,
      );
      const adapter = loaded && this.adapterFor(loaded.snapshot.api, project);
      if (!loaded || !adapter) {
        throw new BadRequestException(
          `Request ${requestNumber} cannot be replayed with this project's upstream`,
        );
      }
      const { model, usageRecordId } = loaded.snapshot;
      const originalInputTokens = this.inputTokens(
        adapter,
        loaded.original,
        model,
      );
      points.push({
        requestNumber,
        model,
        originalInputTokens,
        gcInputTokens: loaded.gc
          ? this.inputTokens(adapter, loaded.gc, model)
          : originalInputTokens,
        outputTokens:
          (usageRecordId && outputs.get(usageRecordId)) ||
          this.config.defaultOutputTokens,
      });
    }

    const judge = this.judgeInfo(project);
    let estimate;
    try {
      estimate = estimateReplay(points, {
        replay: (model) => this.priceFn(model),
        judge: { model: judge.model, price: this.priceFn(judge.model) },
      });
    } catch (error) {
      if (error instanceof UnknownPriceError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return {
      judge,
      view: {
        requestNumbers,
        budgetUsd,
        models: [...new Set(points.map((p) => p.model))],
        judge,
        points: estimate.points,
        totalUsd: estimate.totalUsd,
        overBudget: estimate.totalUsd > budgetUsd,
      },
    };
  }

  /** Why the session cannot be replayed, or null. */
  private blockedReason(
    project: Project,
    candidates: ReplayCandidate[],
  ): string | null {
    if (!this.projects.storesContent(project)) {
      return 'Replay needs content storage, which is off for this project.';
    }
    if (!project.hasProviderKey) {
      return "Replay sends requests with the project's stored provider key. Store one in Settings first.";
    }
    if (!candidates.length) {
      return 'This session has no recorded requests. Requests are recorded while content storage is on.';
    }
    const judge = this.judgeInfo(project);
    if (!judge.model) {
      return judge.keySource === 'project'
        ? 'Choose a judge model for the project key in Settings.'
        : 'The replay judge is not set up: set PARSIM_INTERNAL_MODEL and its provider key.';
    }
    if (judge.keySource === 'parsim' && !this.internal().apiKey) {
      return "The replay judge is not set up: the internal provider's key is missing.";
    }
    return null;
  }

  private defaultPoints(candidates: ReplayCandidate[]): number[] {
    const changed = candidates.filter((c) => c.gcChanged);
    return spreadPoints(
      (changed.length ? changed : candidates).map((c) => c.requestNumber),
      this.config.defaultPoints,
    );
  }

  private internal() {
    return this.configService.getOrThrow('compression.internal', {
      infer: true,
    });
  }

  /** Which model judges, and whose key pays for it (no key). */
  private judgeInfo(project: Project): JudgeInfo {
    if (project.replayJudgeKeySource === 'project') {
      return {
        keySource: 'project',
        provider: project.upstream,
        model: project.replayJudgeModel ?? '',
      };
    }
    const internal = this.internal();
    return {
      keySource: 'parsim',
      provider: internal.provider,
      model: this.config.judgeModel || internal.model,
    };
  }

  private judgeTarget(project: Project): SummarizerTarget {
    const info = this.judgeInfo(project);
    const proxy = this.configService.getOrThrow('proxy', { infer: true });
    try {
      return info.keySource === 'project'
        ? projectTarget(
            project,
            this.projects.storedProviderKey(project),
            info.model,
            proxy,
          )
        : internalTarget(this.internal(), info.model, proxy);
    } catch (error) {
      if (error instanceof SummarizerError) {
        throw new ReplayError('the replay judge has no model or key');
      }
      throw error;
    }
  }

  private priceFn(model: string): PriceFn | null {
    const probe = this.pricing.costUsd(model, usage(0, 0));
    if (probe === null) return null;
    return (input, output) => this.pricing.costUsd(model, usage(input, output));
  }

  /** An openai-compatible project's base URL, checked like the proxy does. */
  private upstreamBaseUrl(project: Project): string | undefined {
    if (project.upstream !== 'openai-compatible') return undefined;
    const check = checkCustomUpstream(
      project.upstreamBaseUrl,
      this.configService.getOrThrow('proxy.customUpstream', { infer: true }),
    );
    if (!check.allowed) throw new ReplayError(check.reason);
    return check.baseUrl;
  }

  private adapterFor(api: ProxyApi, project: Project): ProviderAdapter | null {
    return this.adapters.get(`${api}:${project.upstream}`) ?? null;
  }

  /** Context tokens of a request body, plus its tool definitions. */
  private inputTokens(
    adapter: ProviderAdapter,
    body: Record<string, unknown>,
    model: string,
  ): number {
    const target = { upstream: adapter.upstream, model };
    const items = extractContextItems(
      adapter.converter.toInternal(body, { model }),
    );
    const tools = body.tools ? JSON.stringify(body.tools) : '';
    return (
      items.reduce(
        (sum, item) =>
          sum +
          this.tokens.count(item.tokenText, item.imageCount, target).tokens,
        0,
      ) + (tools ? this.tokens.count(tools, 0, target).tokens : 0)
    );
  }

  private count(text: string, judge: SummarizerTarget): number {
    return this.tokens.count(text, 0, {
      upstream: judge.provider,
      model: judge.model,
    }).tokens;
  }

  /** The latest user message or tool result, as context for the judge. */
  private judgeContext(
    adapter: ProviderAdapter,
    body: Record<string, unknown>,
    model: string,
  ): string {
    const items = extractContextItems(
      adapter.converter.toInternal(body, { model }),
    );
    const last = [...items]
      .reverse()
      .find((item) => item.kind === 'user' || item.kind === 'tool_result');
    return last?.tokenText ?? '';
  }

  private async recordedOutputs(
    ids: (string | null)[],
  ): Promise<Map<string, number>> {
    const present = ids.filter((id): id is string => Boolean(id));
    if (!present.length) return new Map();
    const rows = (await this.db.query(
      `SELECT id, "outputTokens" FROM usage_record WHERE id = ANY($1::uuid[])`,
      [present],
    )) as { id: string; outputTokens: number }[];
    return new Map(rows.map((r) => [r.id, Number(r.outputTokens)]));
  }

  /** The project, if the user owns it and the session belongs to it. */
  private async owned(
    ownerId: number,
    projectId: string,
    sessionId: string,
  ): Promise<Project> {
    const project = await this.projects.findOwned(ownerId, projectId);
    const rows = (await this.db.query(
      `SELECT 1 FROM agent_session WHERE id = $1 AND "projectId" = $2`,
      [sessionId, project.id],
    )) as unknown[];
    if (!rows.length) throw new NotFoundException();
    return project;
  }
}

const usage = (input: number, output: number): TokenUsage => ({
  inputTokens: input,
  outputTokens: output,
  cachedInputTokens: null,
  cacheWriteInputTokens: null,
});

function toCandidates(snapshots: RequestSnapshot[]): ReplayCandidate[] {
  return snapshots.map((s) => ({
    requestNumber: s.requestNumber,
    gcChanged: s.gc !== null,
    model: s.model,
    createdAt: s.createdAt.toISOString(),
  }));
}

function failedPoint(
  replayId: string,
  requestNumber: number,
  error: string,
): Omit<ReplayResult, 'id' | 'createdAt'> {
  return {
    replayId,
    requestNumber,
    status: 'failed',
    gcChanged: false,
    original: null,
    gc: null,
    exactMatch: null,
    toolCallsMatch: null,
    judgeScore: null,
    judgeReason: null,
    judgeCostUsd: 0,
    agreed: null,
    error,
  };
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function toSummary(replay: Replay): ReplaySummary {
  return {
    id: replay.id,
    status: replay.status,
    requestNumbers: replay.requestNumbers,
    pointsTotal: replay.requestNumbers.length,
    pointsDone: replay.pointsDone,
    budgetUsd: replay.budgetUsd,
    estimatedCostUsd: replay.estimatedCostUsd,
    spentUsd: replay.spentUsd,
    judgeKeySource: replay.judgeKeySource,
    judgeProvider: replay.judgeProvider,
    judgeModel: replay.judgeModel,
    error: replay.error,
    createdAt: replay.createdAt.toISOString(),
    startedAt: iso(replay.startedAt),
    finishedAt: iso(replay.finishedAt),
  };
}

export function buildReport(
  replay: Replay,
  results: ReplayResult[],
  contentAllowed: boolean,
): ReplayReport {
  const totals = (
    pick: (r: ReplayResult) => ReplayResult['gc'],
  ): VersionTotals => {
    const sum = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    for (const result of results) {
      const variant = pick(result);
      if (!variant) continue;
      sum.inputTokens += variant.inputTokens;
      sum.outputTokens += variant.outputTokens;
      sum.costUsd += variant.costUsd;
    }
    return { ...sum, costUsd: roundUsd(sum.costUsd) };
  };
  const variant = (v: ReplayResult['gc']): VariantView | null =>
    v && {
      status: v.status,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      costUsd: v.costUsd,
      temperatureZero: v.temperatureZero,
      upstreamCalls: v.upstreamCalls,
      recalls: v.recalls,
      error: v.error,
      ...(contentAllowed && { answer: v.answer }),
    };
  const completed = results.filter((r) => r.status === 'completed');
  return {
    replay: toSummary(replay),
    contentAllowed,
    agreement: {
      ...agreementRate(completed),
      exactMatches: completed.filter((r) => r.exactMatch).length,
      toolCallMatches: completed.filter((r) => r.toolCallsMatch).length,
      failed: results.length - completed.length,
    },
    totals: {
      original: totals((r) => r.original),
      gc: totals((r) => r.gc),
      judgeCostUsd: roundUsd(results.reduce((s, r) => s + r.judgeCostUsd, 0)),
    },
    points: results.map(
      (r): ReplayPointView => ({
        requestNumber: r.requestNumber,
        status: r.status,
        gcChanged: r.gcChanged,
        exactMatch: r.exactMatch,
        toolCallsMatch: r.toolCallsMatch,
        judgeScore: r.judgeScore,
        ...(contentAllowed && { judgeReason: r.judgeReason }),
        judgeCostUsd: r.judgeCostUsd,
        agreed: r.agreed,
        error: r.error,
        original: variant(r.original),
        gc: variant(r.gc),
      }),
    ),
  };
}
