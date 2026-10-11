import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentSessionRepository } from '../agent-sessions/infrastructure/persistence/agent-session.repository';
import { ArchivedItemRepository } from '../archived-items/infrastructure/persistence/archived-item.repository';
import { AllConfigType } from '../config/config.type';
import { canonicalJson } from '../context/canonical-json';
import { extractContextItems } from '../context/context-items';
import {
  isObject,
  MessageConverter,
} from '../context/normalization/internal-model';
import { resolveSessionId } from '../context/session-id';
import { TokenCounter } from '../context/token-counter';
import { GcDecisionRepository } from '../gc-decisions/infrastructure/persistence/gc-decision.repository';
import { GcRunRepository } from '../gc-runs/infrastructure/persistence/gc-run.repository';
import { GcMode } from '../gc/gc-config';
import { runGc } from '../gc/gc-engine';
import { GcResult } from '../gc/gc-types';
import { Project } from '../projects/domain/project';
import { Upstream } from './providers/provider-adapter';

export type GcRequest = {
  project: Project;
  upstream: Upstream;
  converter: MessageConverter;
  /** The request body as the client sent it. */
  rawBody: Buffer;
  sessionHeader: unknown;
};

/** The outcome of one GC evaluation, recorded after the response. */
export type GcEvaluation = {
  mode: Exclude<GcMode, 'off'>;
  /** Null when the GC failed. */
  result: GcResult | null;
  /** Error class name when the GC failed (never the message). */
  error: string | null;
  /** The body to forward: the GC'd request, or the original. */
  body: Buffer;
  /** Whether `body` is the GC'd request. */
  applied: boolean;
  durationMs: number;
};

/**
 * Runs the GC engine for the proxy and stores what it decided. In shadow
 * mode it runs after the response, on the original request, and only
 * records. In on mode it runs before forwarding and stores the archived
 * originals before the smaller request is sent.
 *
 * Fails open: any error means the original request is forwarded unchanged,
 * and the error is logged by class name only, never with content.
 */
@Injectable()
export class ProxyGcService {
  private readonly logger = new Logger(ProxyGcService.name);
  private readonly tokens = new TokenCounter();

  constructor(
    private readonly sessions: AgentSessionRepository,
    private readonly decisions: GcDecisionRepository,
    private readonly runs: GcRunRepository,
    private readonly archive: ArchivedItemRepository,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** On mode: the request to forward. Never throws. */
  async beforeForward(input: GcRequest): Promise<GcEvaluation> {
    const started = performance.now();
    try {
      const { result, converter } = await this.evaluate(input);
      if (!result.decisions.length) {
        return this.done('on', input, started, result, false);
      }
      const body = Buffer.from(
        JSON.stringify(converter.fromInternal(result.request)),
      );
      // Store every archived original before the stub is sent, so it is
      // always recallable (including archives first decided in shadow mode).
      await this.archive.insertMissing(
        result.decisions
          .filter((d) => d.decision === 'archive')
          .map((d) => ({
            projectId: input.project.id,
            archiveId: d.archiveId!,
            toolName: d.toolName,
            contentHash: d.contentHash,
            tokenCount: d.tokensBefore,
            content: d.original,
            sizeBytes: Buffer.byteLength(canonicalJson(d.original)),
          })),
      );
      return {
        ...this.done('on', input, started, result, true),
        body,
      };
    } catch (error) {
      return this.failed('on', input, started, error);
    }
  }

  /** Shadow mode: what the GC would have done. Never throws. */
  async shadow(input: GcRequest): Promise<GcEvaluation> {
    const started = performance.now();
    try {
      const { result } = await this.evaluate(input);
      return this.done('shadow', input, started, result, false);
    } catch (error) {
      return this.failed('shadow', input, started, error);
    }
  }

  /**
   * Stores the run and the decisions it made first. Decisions need the
   * agent session; without one only the run is stored. Never throws.
   */
  async record(
    evaluation: GcEvaluation,
    ids: {
      projectId: string;
      agentSessionId: string | null;
      usageRecordId: string | null;
    },
  ): Promise<void> {
    const { result } = evaluation;
    const fresh = result?.decisions.filter((d) => !d.sticky) ?? [];
    try {
      const run = await this.runs.create({
        projectId: ids.projectId,
        agentSessionId: ids.agentSessionId,
        usageRecordId: ids.usageRecordId,
        mode: evaluation.mode,
        ran: result?.ran ?? false,
        applied: evaluation.applied,
        failed: result === null,
        error: evaluation.error,
        tokensBefore: result?.tokensBefore ?? null,
        tokensAfter: result?.tokensAfter ?? null,
        decisionCount: result?.decisions.length ?? 0,
        newDecisionCount: fresh.length,
        durationMs: evaluation.durationMs,
      });
      const agentSessionId = ids.agentSessionId;
      if (agentSessionId && fresh.length) {
        await this.decisions.insertMissing(
          fresh.map((d) => ({
            gcRunId: run.id,
            agentSessionId,
            itemKey: d.itemKey,
            position: d.position,
            toolCallId: d.toolCallId,
            toolName: d.toolName,
            contentHash: d.contentHash,
            decision: d.decision,
            reason: d.reason,
            detail: d.detail,
            tokensBefore: d.tokensBefore,
            tokensAfter: d.tokensAfter,
            replacement: d.replacement,
            archiveId: d.archiveId,
          })),
        );
      }
      this.logger.log(
        `gc project=${ids.projectId} session=${agentSessionId ?? '-'} mode=${evaluation.mode} ran=${run.ran} applied=${run.applied} failed=${run.failed} tokensBefore=${run.tokensBefore ?? '-'} tokensAfter=${run.tokensAfter ?? '-'} decisions=${run.decisionCount} new=${run.newDecisionCount} durationMs=${run.durationMs}`,
      );
    } catch (error) {
      this.logger.error(
        `Could not store gc run project=${ids.projectId}: ${(error as Error)?.name ?? 'Error'}`,
      );
    }
  }

  private async evaluate(
    input: GcRequest,
  ): Promise<{ result: GcResult; converter: MessageConverter }> {
    const body: unknown = JSON.parse(input.rawBody.toString('utf8'));
    if (!isObject(body)) throw new TypeError('Request body is not an object');
    const request = input.converter.toInternal(body);
    const identity = resolveSessionId({
      header: input.sessionHeader,
      upstream: input.upstream,
      model: request.model,
      items: extractContextItems(request),
    });
    const session = await this.sessions.findByExternalId(
      input.project.id,
      identity.externalId,
    );
    const prior = session ? await this.decisions.findBySession(session.id) : [];
    const target = { upstream: input.upstream, model: request.model };
    const result = runGc({
      request,
      config: this.configService.getOrThrow('gc', { infer: true }),
      countTokens: (text, images) =>
        this.tokens.count(text, images, target).tokens,
      prior,
    });
    return { result, converter: input.converter };
  }

  private done(
    mode: GcEvaluation['mode'],
    input: GcRequest,
    started: number,
    result: GcResult,
    applied: boolean,
  ): GcEvaluation {
    return {
      mode,
      result,
      error: null,
      body: input.rawBody,
      applied,
      durationMs: Math.round(performance.now() - started),
    };
  }

  private failed(
    mode: GcEvaluation['mode'],
    input: GcRequest,
    started: number,
    error: unknown,
  ): GcEvaluation {
    const name = (error as Error)?.name || 'Error';
    this.logger.error(
      `GC failed, forwarding the original request project=${input.project.id} mode=${mode} error=${name}`,
    );
    return {
      mode,
      result: null,
      error: name,
      body: input.rawBody,
      applied: false,
      durationMs: Math.round(performance.now() - started),
    };
  }
}
