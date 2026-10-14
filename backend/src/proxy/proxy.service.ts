import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AllConfigType } from '../config/config.type';
import { ContextCaptureService } from '../context/context-capture.service';
import { SESSION_HEADER } from '../context/session-id';
import { ParsimApiKeysService } from '../parsim-api-keys/parsim-api-keys.service';
import { Project } from '../projects/domain/project';
import { ProjectsService } from '../projects/projects.service';
import { TokenUsage } from '../usage-records/domain/token-usage';
import { UsageRecordsService } from '../usage-records/usage-records.service';
import {
  parseProxyCredentials,
  omitKey,
  QueryParams,
} from './proxy-credentials';
import {
  GcEvaluation,
  GcRequest,
  ProxyGcService,
  usesCachedContent,
} from './proxy-gc.service';
import { ProxyError, proxyErrors } from './proxy-error';
import {
  PreparedUpstreamRequest,
  PROVIDER_ADAPTERS,
  ProviderAdapter,
  ProxyApi,
  ProxyOperation,
  RequestInfo,
  Upstream,
} from './providers/provider-adapter';
import { SseStreamFilter } from './streaming/sse-stream-filter';
import { archiveStubIds } from '../recall/archive-stubs';
import { STATE_BLOCK_START } from '../compression/state-block';
import {
  AssistantTurn,
  isObject,
  RecallFormat,
  StreamEvent,
  StreamSplicer,
  StreamWatcher,
} from '../recall/recall-format';
import { RECALL_FORMATS } from '../recall/recall-formats';
import { planRecallRound } from '../recall/recall-limit';
import { RecallLogEntry, RecallService } from '../recall/recall.service';
import { SseEventSplitter } from '../recall/sse-events';

/** Status recorded when the client disconnects before the response ends. */
const CLIENT_CLOSED_REQUEST = 499;

/** Upstream response headers that must not be copied to the client. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  // fetch already decompressed the body, so its encoding no longer applies
  'content-encoding',
  'set-cookie',
  'alt-svc',
  'server',
  'date',
]);

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The endpoint each upstream is served on, for wrong-endpoint errors. */
const ENDPOINT_FOR_UPSTREAM: Record<Upstream, string> = {
  openai: '/v1/chat/completions',
  gemini: '/v1/chat/completions or /v1beta/models/{model}:generateContent',
  anthropic: '/v1/messages',
};

type Forward = {
  operation: ProxyOperation;
  project: Project;
  adapter: ProviderAdapter;
  info: RequestInfo;
  prepared: PreparedUpstreamRequest;
  /** The request body as received, for context storage after the response. */
  rawBody: Buffer;
  sessionHeader: unknown;
  startedAt: number;
  /** On mode: the GC evaluation made before forwarding. */
  gc: GcEvaluation | null;
  /** Set when the forwarded request carries archive stubs (on mode). */
  recall: RecallPlan | null;
  /** Prepares another upstream call with a new body (recall follow-ups). */
  prepareBody: (body: Buffer) => PreparedUpstreamRequest;
};

/** parsim_recall handling for one request: its format and injected body. */
type RecallPlan = { format: RecallFormat; body: Record<string, unknown> };

type Outcome = {
  status: number;
  /** Summed over every upstream call of the request. */
  usage: TokenUsage | null;
  upstreamCalls?: number;
  recalls?: RecallLogEntry[];
};

/** Cancellation and timeouts shared by a request's upstream calls. */
type UpstreamLink = {
  signal: AbortSignal;
  state: { timedOut: boolean; clientGone: boolean };
  /** (Re)starts the timeout. */
  arm: () => void;
  /** The status to record when a stream breaks off. */
  interruptedStatus: () => number;
  close: () => void;
};

/** How follow-up streams are joined to the client's stream. */
type SpliceState = {
  started: boolean;
  splice: StreamSplicer | null;
  responseId: string | null;
  blockOffset: number;
};

/**
 * The proxy pipeline shared by every endpoint and provider: authenticate,
 * pick the adapter for the client's API and the project's upstream, forward
 * the request, relay the response unchanged (streamed or not) and record
 * token usage. Never logs keys or content.
 */
@Injectable()
export class ProxyService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ProxyService.name);
  private readonly adapters: Map<string, ProviderAdapter>;
  /** Requests still running, including their usage record write. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    @Inject(PROVIDER_ADAPTERS) adapters: ProviderAdapter[],
    private readonly keysService: ParsimApiKeysService,
    private readonly projectsService: ProjectsService,
    private readonly usageRecords: UsageRecordsService,
    private readonly contextCapture: ContextCaptureService,
    private readonly gc: ProxyGcService,
    private readonly recall: RecallService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    this.adapters = new Map(
      adapters.map((a) => [adapterKey(a.api, a.upstream), a]),
    );
  }

  /**
   * Proxies one request for the given endpoint. `model` is for APIs that
   * put the model in the URL (Gemini native).
   */
  handle(
    operation: ProxyOperation,
    req: Request,
    res: Response,
    model?: string,
  ): Promise<void> {
    const handling = this.run(operation, req, res, model);
    this.inFlight.add(handling);
    void handling.finally(() => this.inFlight.delete(handling));
    return handling;
  }

  /** Resolves once every running request has finished and been recorded. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /** Lets running requests finish and record usage before the app stops. */
  beforeApplicationShutdown(): Promise<void> {
    return this.whenIdle();
  }

  private async run(
    operation: ProxyOperation,
    req: Request,
    res: Response,
    model: string | undefined,
  ): Promise<void> {
    const startedAt = performance.now();
    let forward: Forward;
    try {
      forward = await this.prepare(operation, req, startedAt, model);
    } catch (error) {
      this.sendError(res, error, operation.api);
      return;
    }

    let outcome: Outcome;
    try {
      outcome = await this.forward(forward, req, res);
    } catch (error) {
      this.logger.error(
        `Proxy failure project=${forward.project.id}: ${(error as Error).message}`,
      );
      this.sendError(res, error, operation.api);
      outcome = { status: res.statusCode || 500, usage: null };
    }
    await this.record(forward, outcome);
  }

  private async prepare(
    operation: ProxyOperation,
    req: Request,
    startedAt: number,
    model: string | undefined,
  ): Promise<Forward> {
    const query = (req.query ?? {}) as QueryParams;
    const credentials = parseProxyCredentials(
      req.headers,
      operation.api,
      query,
    );
    const project = await this.resolveProject(req, credentials.parsimKey);

    const adapter = this.adapters.get(
      adapterKey(operation.api, project.upstream),
    );
    if (!adapter) {
      throw proxyErrors.wrongEndpoint(
        project.upstream,
        ENDPOINT_FOR_UPSTREAM[project.upstream],
      );
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const info: RequestInfo = {
      ...readRequestInfo(rawBody),
      ...(model !== undefined && { model }),
      ...(operation.stream !== undefined && { stream: operation.stream }),
    };

    const providerKey =
      credentials.providerKey ??
      this.projectsService.storedProviderKey(project);
    if (!providerKey) throw proxyErrors.missingProviderKey();

    const sessionHeader = req.headers[SESSION_HEADER];
    // On mode runs the GC now and forwards its result (or, if it fails, the
    // original). Shadow mode runs after the response, adding no latency.
    const gc =
      operation.recordsUsage && project.gcMode === 'on'
        ? await this.gc.beforeForward(
            gcRequest(project, adapter, rawBody, info.model, sessionHeader),
          )
        : null;

    const prepareBody = (body: Buffer) =>
      adapter.prepare({
        operation,
        rawBody: body,
        info,
        providerKey,
        clientHeaders: req.headers,
        query: omitKey(query),
      });
    const recall = gc?.applied
      ? this.recallPlan(project, adapter, gc.body)
      : null;

    return {
      operation,
      project,
      adapter,
      info,
      prepared: prepareBody(
        recall
          ? Buffer.from(JSON.stringify(recall.body))
          : (gc?.body ?? rawBody),
      ),
      prepareBody,
      rawBody,
      sessionHeader,
      startedAt,
      gc,
      recall,
    };
  }

  /**
   * When the GC'd request contains archive stubs, adds the parsim_recall
   * tool and system line to it. Null when there is nothing to recall, when
   * recall is turned off, or (failing open) when the injection fails.
   */
  private recallPlan(
    project: Project,
    adapter: ProviderAdapter,
    body: Buffer,
  ): RecallPlan | null {
    const max = this.configService.getOrThrow('proxy.recallMaxPerRequest', {
      infer: true,
    });
    if (max < 1) return null;
    try {
      const text = body.toString('utf8');
      // Archive stubs and state blocks both point at recallable originals.
      if (!archiveStubIds(text).length && !text.includes(STATE_BLOCK_START)) {
        return null;
      }
      const parsed = JSON.parse(text) as Record<string, unknown>;
      // Gemini rejects tools or a system instruction next to cachedContent.
      if (usesCachedContent(parsed)) return null;
      const format = RECALL_FORMATS[adapter.api];
      return { format, body: format.inject(parsed) };
    } catch (error) {
      this.logger.error(
        `Could not add parsim_recall, forwarding without it project=${project.id}: ${(error as Error)?.name ?? 'Error'}`,
      );
      return null;
    }
  }

  private async resolveProject(
    req: Request,
    parsimKey: string | undefined,
  ): Promise<Project> {
    if (parsimKey) {
      const key = await this.keysService.verify(parsimKey);
      const project =
        key && (await this.projectsService.findById(key.projectId));
      if (!project) throw proxyErrors.invalidParsimKey();
      return project;
    }

    if (this.keylessAllowed(req)) {
      const project = await this.projectsService.findOldest();
      if (!project) throw proxyErrors.noDevProject();
      return project;
    }
    throw proxyErrors.missingParsimKey();
  }

  /** PARSIM_REQUIRE_KEY=false only works for localhost outside production. */
  private keylessAllowed(req: Request): boolean {
    const requireKey = this.configService.getOrThrow('proxy.requireKey', {
      infer: true,
    });
    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
    return (
      !requireKey &&
      nodeEnv !== 'production' &&
      LOOPBACK.has(req.socket.remoteAddress ?? '')
    );
  }

  private async forward(
    forward: Forward,
    req: Request,
    res: Response,
  ): Promise<Outcome> {
    const link = this.openLink(req, res);
    try {
      return forward.recall
        ? await this.forwardWithRecall(forward, forward.recall, res, link)
        : await this.forwardOnce(forward, res, link);
    } finally {
      link.close();
    }
  }

  /** One upstream call, relayed unchanged. */
  private async forwardOnce(
    { adapter, info, prepared }: Forward,
    res: Response,
    link: UpstreamLink,
  ): Promise<Outcome> {
    const upstream = await this.callUpstream(prepared, link);
    if (!upstream) return { status: CLIENT_CLOSED_REQUEST, usage: null };

    if (!isEventStream(info, upstream)) {
      const body = await this.readBody(upstream, link);
      if (!body) return { status: CLIENT_CLOSED_REQUEST, usage: null };
      sendHead(res, upstream);
      res.end(body);
      return {
        status: upstream.status,
        usage: upstream.ok ? adapter.usageFromResponse(parseJson(body)) : null,
      };
    }

    sendHead(res, upstream);
    startStream(res);
    const filter = new SseStreamFilter(
      (event, previous) => adapter.usageFromStreamEvent(event, previous),
      prepared.usageInjected,
    );
    const reader = upstream.body!.getReader();
    try {
      for (;;) {
        link.arm();
        const { done, value } = await reader.read();
        if (done) break;
        const out = filter.push(Buffer.from(value));
        if (out.length && !res.write(out)) await drained(res);
      }
      const rest = filter.flush();
      if (rest.length) res.write(rest);
      res.end();
      return { status: upstream.status, usage: filter.usage };
    } catch {
      // Client gone, timeout between chunks, or the upstream connection broke.
      res.end();
      return { status: link.interruptedStatus(), usage: filter.usage };
    }
  }

  /**
   * Forwards a request that carries archive stubs, answering the model's
   * parsim_recall calls itself: each time the model asks for archives, the
   * originals are sent back upstream in a follow-up request, and only the
   * final answer reaches the client. Streams are relayed as they arrive,
   * except that tool calls are held until the response ends (any of them
   * may be parsim_recall); follow-up streams are spliced into the client's
   * stream so it sees one response.
   */
  private async forwardWithRecall(
    forward: Forward,
    recall: RecallPlan,
    res: Response,
    link: UpstreamLink,
  ): Promise<Outcome> {
    const { adapter, info, project } = forward;
    const { format } = recall;
    const max = this.configService.getOrThrow('proxy.recallMaxPerRequest', {
      infer: true,
    });
    const stream: SpliceState = {
      started: false,
      splice: null,
      responseId: null,
      blockOffset: 0,
    };
    const recalls: RecallLogEntry[] = [];
    let body = recall.body;
    let prepared = forward.prepared;
    let usage: TokenUsage | null = null;
    let upstreamCalls = 0;
    let used = 0;
    let final = false;
    const done = (status: number): Outcome => ({
      status,
      usage,
      upstreamCalls,
      recalls,
    });

    for (;;) {
      upstreamCalls += 1;
      const upstream = await this.callUpstream(prepared, link);
      if (!upstream) return done(CLIENT_CLOSED_REQUEST);

      let turn: AssistantTurn | null;
      if (!isEventStream(info, upstream)) {
        const raw = await this.readBody(upstream, link);
        if (!raw) return done(CLIENT_CLOSED_REQUEST);
        const json = parseJson(raw);
        if (upstream.ok) {
          usage = addUsage(usage, adapter.usageFromResponse(json));
        }
        turn =
          upstream.ok && !final && !stream.started
            ? format.turnFromResponse(json)
            : null;
        if (!turn?.recallCalls.length) {
          if (stream.started) {
            // A follow-up failed after the stream began: end the stream.
            res.end();
            return done(upstream.ok ? res.statusCode : upstream.status);
          }
          sendHead(res, upstream);
          res.end(raw);
          return done(upstream.status);
        }
      } else {
        if (!stream.started) {
          sendHead(res, upstream);
          startStream(res);
          stream.started = true;
        }
        const relayed = await this.relayRecallStream(
          upstream,
          res,
          forward.adapter,
          prepared,
          link,
          final ? null : format.newStreamWatcher(),
          stream,
        );
        usage = addUsage(usage, relayed.usage);
        if (relayed.interrupted !== null) return done(relayed.interrupted);
        turn = relayed.turn;
        if (!turn?.recallCalls.length) {
          for (const text of relayed.held) res.write(text);
          res.end();
          return done(upstream.status);
        }
        stream.blockOffset += relayed.forwardedBlocks;
        stream.splice = format.newSplicer({
          responseId: stream.responseId,
          blockOffset: stream.blockOffset,
        });
      }

      const round = planRecallRound(turn.recallCalls, used, max);
      const resolved = await this.recall.resolve(project.id, round);
      used += round.fetch.length;
      recalls.push(...resolved.log);
      final = round.final;
      body = format.followUp(body, turn, resolved.results, final);
      prepared = forward.prepareBody(Buffer.from(JSON.stringify(body)));
    }
  }

  /**
   * Relays one streamed response of a recall loop. Events go to the client
   * as they complete, through the splicer for follow-ups, until the
   * watcher holds them (a tool call started). Held events are returned.
   */
  private async relayRecallStream(
    upstream: globalThis.Response,
    res: Response,
    adapter: ProviderAdapter,
    prepared: PreparedUpstreamRequest,
    link: UpstreamLink,
    watcher: StreamWatcher | null,
    stream: SpliceState,
  ): Promise<{
    usage: TokenUsage | null;
    turn: AssistantTurn | null;
    forwardedBlocks: number;
    held: string[];
    interrupted: number | null;
  }> {
    const filter = new SseStreamFilter(
      (event, previous) => adapter.usageFromStreamEvent(event, previous),
      prepared.usageInjected,
    );
    const splitter = new SseEventSplitter();
    const held: string[] = [];
    const handle = async (events: StreamEvent[]) => {
      for (const event of events) {
        if (
          stream.responseId === null &&
          isObject(event.data) &&
          typeof event.data.id === 'string'
        ) {
          stream.responseId = event.data.id;
        }
        const forwardNow = watcher ? watcher.push(event) : true;
        const text = stream.splice ? stream.splice(event) : event.raw;
        if (text === null) continue;
        if (!forwardNow) held.push(text);
        else if (!res.write(text)) await drained(res);
      }
    };

    const reader = upstream.body!.getReader();
    try {
      for (;;) {
        link.arm();
        const { done, value } = await reader.read();
        if (done) break;
        await handle(splitter.push(filter.push(Buffer.from(value))));
      }
      await handle([...splitter.push(filter.flush()), ...splitter.flush()]);
    } catch {
      res.end();
      return {
        usage: filter.usage,
        turn: null,
        forwardedBlocks: 0,
        held: [],
        interrupted: link.interruptedStatus(),
      };
    }
    return {
      usage: filter.usage,
      turn: watcher?.turn() ?? null,
      forwardedBlocks: watcher?.forwardedBlocks ?? 0,
      held,
      interrupted: null,
    };
  }

  /**
   * Cancellation and timeouts for one client request, shared by all its
   * upstream calls. The timeout covers waiting for headers and every gap
   * between chunks.
   */
  private openLink(req: Request, res: Response): UpstreamLink {
    const timeoutMs = this.configService.getOrThrow('proxy.upstreamTimeoutMs', {
      infer: true,
    });
    const abort = new AbortController();
    const state = { timedOut: false, clientGone: false };
    let timer: NodeJS.Timeout | undefined;
    const onClose = () => {
      if (!res.writableFinished) {
        state.clientGone = true;
        abort.abort();
      }
    };
    res.on('close', onClose);
    return {
      signal: abort.signal,
      state,
      arm: () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.timedOut = true;
          abort.abort();
        }, timeoutMs);
      },
      interruptedStatus: () =>
        state.clientGone ? CLIENT_CLOSED_REQUEST : state.timedOut ? 504 : 502,
      close: () => {
        clearTimeout(timer);
        res.off('close', onClose);
        req.socket?.setTimeout(0);
      },
    };
  }

  /** Sends one upstream request; null if the client went away first. */
  private async callUpstream(
    prepared: PreparedUpstreamRequest,
    link: UpstreamLink,
  ): Promise<globalThis.Response | null> {
    link.arm();
    try {
      return await fetch(prepared.url, {
        method: 'POST',
        headers: prepared.headers,
        body: new Uint8Array(prepared.body),
        signal: link.signal,
      });
    } catch {
      if (link.state.clientGone) return null;
      throw link.state.timedOut
        ? proxyErrors.upstreamTimeout()
        : proxyErrors.upstreamUnreachable();
    }
  }

  /** Reads a whole upstream body; null if the client went away. */
  private async readBody(
    upstream: globalThis.Response,
    link: UpstreamLink,
  ): Promise<Buffer | null> {
    try {
      return Buffer.from(await upstream.arrayBuffer());
    } catch {
      if (link.state.clientGone) return null;
      throw link.state.timedOut
        ? proxyErrors.upstreamTimeout()
        : proxyErrors.upstreamUnreachable();
    }
  }

  private sendError(res: Response, error: unknown, api: ProxyApi): void {
    const proxyError =
      error instanceof ProxyError
        ? error
        : new ProxyError(500, 'Internal proxy error.', 'server_error');
    if (!(error instanceof ProxyError)) {
      this.logger.error(`Unexpected proxy error: ${(error as Error)?.message}`);
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(proxyError.status).json(proxyError.toBody(api));
  }

  private async record(forward: Forward, outcome: Outcome): Promise<void> {
    const latencyMs = Math.round(performance.now() - forward.startedAt);
    this.logger.log(
      `${forward.operation.name} project=${forward.project.id} upstream=${forward.adapter.upstream} model=${forward.info.model} status=${outcome.status} streamed=${forward.info.stream} latencyMs=${latencyMs} inputTokens=${outcome.usage?.inputTokens ?? '-'} outputTokens=${outcome.usage?.outputTokens ?? '-'}`,
    );
    if (!forward.operation.recordsUsage) return;
    const agentSessionId = await this.captureContext(forward);
    let usageRecordId: string | null = null;
    try {
      const usageRecord = await this.usageRecords.record({
        projectId: forward.project.id,
        agentSessionId,
        upstream: forward.adapter.upstream,
        model: forward.info.model,
        usage: outcome.usage,
        latencyMs,
        status: outcome.status,
        streamed: forward.info.stream,
        upstreamCalls: outcome.upstreamCalls,
      });
      usageRecordId = usageRecord.id;
    } catch (error) {
      this.logger.error(
        `Could not save usage record: ${(error as Error).message}`,
      );
    }
    await this.recordGc(forward, agentSessionId, usageRecordId);
    await this.recall.record(outcome.recalls ?? [], {
      projectId: forward.project.id,
      agentSessionId,
      usageRecordId,
    });
  }

  /**
   * Records the GC run of an on-mode request, or runs the GC in shadow
   * mode now that the response has been sent. Never throws.
   */
  private async recordGc(
    forward: Forward,
    agentSessionId: string | null,
    usageRecordId: string | null,
  ): Promise<void> {
    const { project } = forward;
    const evaluation =
      forward.gc ??
      (project.gcMode === 'shadow'
        ? await this.gc.shadow(
            gcRequest(
              project,
              forward.adapter,
              forward.rawBody,
              forward.info.model,
              forward.sessionHeader,
            ),
          )
        : null);
    if (!evaluation) return;
    await this.gc.record(evaluation, {
      projectId: project.id,
      agentSessionId,
      usageRecordId,
    });
    if (evaluation.mode === 'on') {
      await this.gc.afterResponse(
        gcRequest(
          project,
          forward.adapter,
          forward.rawBody,
          forward.info.model,
          forward.sessionHeader,
        ),
        agentSessionId,
        evaluation,
      );
    }
  }

  /**
   * Stores the agent session and context items. Runs after the response
   * has been sent, so it adds no latency, and a failure here never affects
   * the request. Returns the agent session id, or null if storing failed.
   */
  private async captureContext(forward: Forward): Promise<string | null> {
    try {
      const result = await this.contextCapture.capture({
        project: forward.project,
        upstream: forward.adapter.upstream,
        converter: forward.adapter.converter,
        rawBody: forward.rawBody,
        model: forward.info.model,
        sessionHeader: forward.sessionHeader,
        at: new Date(),
      });
      return result.agentSessionId;
    } catch (error) {
      this.logger.error(
        `Could not store context project=${forward.project.id}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

function gcRequest(
  project: Project,
  adapter: ProviderAdapter,
  rawBody: Buffer,
  model: string,
  sessionHeader: unknown,
): GcRequest {
  return {
    project,
    upstream: adapter.upstream,
    converter: adapter.converter,
    rawBody,
    model,
    sessionHeader,
  };
}

function adapterKey(api: ProxyApi, upstream: string): string {
  return `${api}:${upstream}`;
}

/** Reads model, stream and stream_options from the body. Never logs it. */
export function readRequestInfo(rawBody: Buffer): RequestInfo {
  const body = parseJson(rawBody);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw proxyErrors.invalidJson();
  }
  const { model, stream, stream_options } = body as Record<string, unknown>;
  return {
    model: typeof model === 'string' ? model : '',
    stream: stream === true,
    hasStreamOptions: stream_options !== undefined,
  };
}

function isEventStream(
  info: RequestInfo,
  upstream: globalThis.Response,
): boolean {
  const contentType = upstream.headers.get('content-type') ?? '';
  return (
    info.stream && upstream.ok && contentType.includes('text/event-stream')
  );
}

/** Copies the upstream status and headers to the client response. */
function sendHead(res: Response, upstream: globalThis.Response): void {
  res.status(upstream.status);
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name)) res.setHeader(name, value);
  });
}

function startStream(res: Response): void {
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();
}

/** Adds two usages (recall follow-ups); null counts stay null. */
export function addUsage(
  a: TokenUsage | null,
  b: TokenUsage | null,
): TokenUsage | null {
  if (!a || !b) return a ?? b;
  const sum = (x: number | null, y: number | null) =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0);
  const write1h =
    a.cacheWrite1hInputTokens === undefined &&
    b.cacheWrite1hInputTokens === undefined
      ? undefined
      : (a.cacheWrite1hInputTokens ?? 0) + (b.cacheWrite1hInputTokens ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: sum(a.cachedInputTokens, b.cachedInputTokens),
    cacheWriteInputTokens: sum(
      a.cacheWriteInputTokens,
      b.cacheWriteInputTokens,
    ),
    ...(write1h !== undefined && { cacheWrite1hInputTokens: write1h }),
  };
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function drained(res: Response): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
}
