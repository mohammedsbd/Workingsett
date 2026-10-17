import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type PgBoss from 'pg-boss';
import { ArchivedItemRepository } from '../archived-items/infrastructure/persistence/archived-item.repository';
import { Compression } from '../compressions/domain/compression';
import { CompressionRepository } from '../compressions/infrastructure/persistence/compression.repository';
import { AllConfigType } from '../config/config.type';
import { canonicalJson, contentHash } from '../context/canonical-json';
import { ExtractedItem, extractContextItems } from '../context/context-items';
import { InternalRequest } from '../context/normalization/internal-model';
import { TokenCounter } from '../context/token-counter';
import { hasSideEffects } from '../gc/gc-config';
import { JobsService } from '../jobs/jobs.service';
import { Project } from '../projects/domain/project';
import { projectGcConfig } from '../projects/project-gc-config';
import { ProjectsService } from '../projects/projects.service';
import { Upstream } from '../proxy/providers/provider-adapter';
import { archivedText } from '../recall/recall-tool';
import { UsageRecordsService } from '../usage-records/usage-records.service';
import { applyCompressions } from './apply';
import {
  InvalidSummaryError,
  parseSummary,
  renderStateBlock,
} from './state-block';
import {
  findStretch,
  stretchInput,
  tokensInRange,
  worthCompressing,
} from './stretch';
import { internalTarget, projectTarget } from './internal-target';
import { summarize, SummarizerError, SummarizerTarget } from './summarizer';
import { SUMMARY_INSTRUCTIONS, summaryPrompt } from './summary-prompt';

export const COMPRESSION_QUEUE = 'compression-summarize';

type SummarizeJob = { compressionId: string };

type Target = { upstream: Upstream; model: string };

/**
 * Compression of finished stretches into state blocks (see docs/compression.md).
 *
 * - After a response, `maybeEnqueue` looks for the session's next finished
 *   stretch and queues a summary job. Requests never wait for it.
 * - The job summarizes the stretch with Parsim's internal model (or the
 *   project's own key), stores each original message for recall, renders
 *   the state block and records the cost as a 'compression' usage record.
 * - Before forwarding, `apply` swaps every ready stretch that is still in
 *   the request, unchanged, for its stored block, byte for byte.
 *
 * Content is never logged.
 */
@Injectable()
export class CompressionService implements OnModuleInit {
  private readonly logger = new Logger(CompressionService.name);
  private readonly tokens = new TokenCounter();

  constructor(
    private readonly compressions: CompressionRepository,
    private readonly archive: ArchivedItemRepository,
    private readonly projects: ProjectsService,
    private readonly usageRecords: UsageRecordsService,
    private readonly jobs: JobsService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  private get config() {
    return this.configService.getOrThrow('compression', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    const { retryLimit, worker, pollSeconds } = this.config;
    await this.jobs.createQueue(COMPRESSION_QUEUE, {
      retryLimit,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 600,
    });
    if (worker) {
      await this.jobs.work<SummarizeJob>(
        COMPRESSION_QUEUE,
        { pollingIntervalSeconds: pollSeconds },
        (job) => this.handle(job),
      );
    }
  }

  /** Whether compression runs for this project at all. */
  enabledFor(project: Project): boolean {
    return project.gcMode === 'on' && project.compressionEnabled;
  }

  private isSideEffect(project: Project) {
    const config = projectGcConfig(
      project,
      this.configService.getOrThrow('gc', { infer: true }),
    );
    return (name: string) => hasSideEffects(name, config);
  }

  private countItems(items: ExtractedItem[], target: Target): number {
    return items.reduce(
      (sum, item) =>
        sum + this.tokens.count(item.tokenText, item.imageCount, target).tokens,
      0,
    );
  }

  /**
   * Replaces the session's ready stretches with their state blocks.
   * `original` is the request as received, `request` the one to forward
   * (after GC). Returns the request and the tokens the blocks removed.
   */
  async apply(input: {
    project: Project;
    agentSessionId: string;
    original: InternalRequest;
    request: InternalRequest;
    target: Target;
  }): Promise<{
    request: InternalRequest;
    applied: number;
    savedTokens: number;
  }> {
    const ready = (await this.compressions.findBySession(input.agentSessionId))
      .filter((c) => c.status === 'ready' && c.stateBlock !== null)
      .map((c) => ({ ...c, stateBlock: c.stateBlock! }));
    const { request, applied } = applyCompressions({
      original: input.original,
      request: input.request,
      compressions: ready,
      isSideEffect: this.isSideEffect(input.project),
    });
    if (!applied) return { request, applied, savedTokens: 0 };
    const before = this.countItems(
      extractContextItems(input.request),
      input.target,
    );
    const after = this.countItems(extractContextItems(request), input.target);
    // Can be negative when the GC had already shrunk the stretch to stubs.
    return { request, applied, savedTokens: before - after };
  }

  /**
   * After a response: queues a summary of the session's next finished
   * stretch, if there is one and no other summary of this session is
   * pending. Never throws.
   */
  async maybeEnqueue(input: {
    project: Project;
    agentSessionId: string;
    /** The request as the client sent it. */
    request: InternalRequest;
    /** The request as forwarded (after GC), same message indices. */
    sent: InternalRequest;
    target: Target;
  }): Promise<Compression | null> {
    const { project, agentSessionId, request, sent, target } = input;
    try {
      const existing = await this.compressions.findBySession(agentSessionId);
      if (existing.some((c) => c.status === 'pending')) return null;
      const after = Math.max(
        0,
        ...existing.filter((c) => c.status === 'ready').map((c) => c.endIndex),
      );
      const gc = projectGcConfig(
        project,
        this.configService.getOrThrow('gc', { infer: true }),
      );
      const tokensOf = (item: ExtractedItem) =>
        this.tokens.count(item.tokenText, item.imageCount, target).tokens;
      const sentItems = extractContextItems(sent);
      const stretch = findStretch(
        request,
        extractContextItems(request),
        tokensInRange(sentItems, tokensOf),
        after,
        { minTokens: this.config.minTokens, protectedTurns: gc.protectedTurns },
      );
      if (!stretch) return null;
      const isSideEffect = this.isSideEffect(project);
      const stretchData = stretchInput(request, stretch, isSideEffect);
      const { worth, estimate } = worthCompressing({
        sent,
        sentItems,
        stretch,
        stretchInput: stretchData,
        isSideEffect,
        count: (text) => this.tokens.count(text, 0, target).tokens,
        tokensOf,
      });
      if (!worth) {
        this.logger.log(
          `compression skipped project=${project.id} session=${agentSessionId} turns=${stretch.firstTurn}-${stretch.lastTurn} tokens=${stretch.tokens} estimate=${estimate}`,
        );
        return null;
      }
      const created = await this.compressions.createPending({
        projectId: project.id,
        agentSessionId,
        stretchKey: stretch.key,
        startIndex: stretch.startIndex,
        endIndex: stretch.endIndex,
        firstTurn: stretch.firstTurn,
        lastTurn: stretch.lastTurn,
        input: stretchData,
        tokensBefore: stretch.tokens,
      });
      if (!created) return null;
      await this.jobs.send(COMPRESSION_QUEUE, { compressionId: created.id });
      this.logger.log(
        `compression queued project=${project.id} session=${agentSessionId} id=${created.id} turns=${stretch.firstTurn}-${stretch.lastTurn} tokens=${stretch.tokens}`,
      );
      return created;
    } catch (error) {
      this.logger.error(
        `Could not queue compression project=${project.id}: ${(error as Error)?.name ?? 'Error'}`,
      );
      return null;
    }
  }

  /**
   * The summary job. Throws (so pg-boss retries) only for errors that may
   * pass and while retries are left; otherwise marks the compression failed.
   */
  async handle(job: PgBoss.JobWithMetadata<SummarizeJob>): Promise<void> {
    const { compressionId } = job.data;
    try {
      await this.summarizeCompression(compressionId);
    } catch (error) {
      const retryable =
        error instanceof InvalidSummaryError ||
        (error instanceof SummarizerError && error.retryable);
      const reason =
        error instanceof SummarizerError || error instanceof InvalidSummaryError
          ? error.message
          : ((error as Error)?.name ?? 'Error');
      if (retryable && job.retryCount < job.retryLimit) {
        this.logger.warn(
          `compression retry id=${compressionId} try=${job.retryCount + 1} reason=${reason}`,
        );
        throw error;
      }
      this.logger.error(
        `compression failed id=${compressionId} reason=${reason}`,
      );
      await this.compressions.markFailed(compressionId, reason.slice(0, 500));
    }
  }

  private async summarizeCompression(id: string): Promise<void> {
    const compression = await this.compressions.findById(id);
    if (
      !compression ||
      compression.status !== 'pending' ||
      !compression.input
    ) {
      return;
    }
    const project = await this.projects.findById(compression.projectId);
    if (!project) throw new SummarizerError('project not found', false);
    const target = this.target(project);
    const { input } = compression;

    const started = performance.now();
    const result = await summarize(
      target,
      SUMMARY_INSTRUCTIONS,
      summaryPrompt(input),
    );
    // Paid for even if the summary turns out invalid.
    const usage = await this.usageRecords.record({
      projectId: project.id,
      agentSessionId: compression.agentSessionId,
      upstream: target.provider,
      model: target.model,
      usage: result.usage,
      latencyMs: Math.round(performance.now() - started),
      status: 200,
      streamed: false,
      kind: 'compression',
    });
    const summary = parseSummary(result.text);

    const counted = { upstream: target.provider, model: target.model };
    const toolNames = (m: (typeof input.messages)[number]) =>
      m.content.parts
        .map((p) => (p.type === 'tool_call' ? p.name : ''))
        .filter(Boolean)
        .join(', ');
    await this.archive.insertMissing(
      input.messages.map((m) => ({
        projectId: project.id,
        archiveId: m.archiveId,
        toolName:
          m.role === 'tool'
            ? 'tool result'
            : toolNames(m) || `${m.role} message`,
        contentHash: contentHash(m.content),
        tokenCount: this.tokens.count(archivedText(m.content), 0, counted)
          .tokens,
        content: m.content,
        sizeBytes: Buffer.byteLength(canonicalJson(m.content)),
      })),
    );

    const stateBlock = renderStateBlock({
      summary,
      firstTurn: compression.firstTurn,
      lastTurn: compression.lastTurn,
      actions: input.actions,
      messages: input.messages,
    });
    await this.compressions.markReady(id, {
      stateBlock,
      tokensAfter: this.tokens.count(stateBlock, 0, counted).tokens,
      usageRecordId: usage.id,
    });
    this.logger.log(
      `compression ready id=${id} project=${project.id} tokensBefore=${compression.tokensBefore} usage=${usage.id}`,
    );
  }

  /** Who computes the summary: Parsim's internal model or the project's key. */
  private target(project: Project): SummarizerTarget {
    const proxy = this.configService.getOrThrow('proxy', { infer: true });
    if (project.compressionKeySource === 'project') {
      return projectTarget(
        project,
        this.projects.storedProviderKey(project),
        project.compressionModel,
        proxy,
      );
    }
    return internalTarget(
      this.config.internal,
      this.config.internal.model,
      proxy,
    );
  }
}
