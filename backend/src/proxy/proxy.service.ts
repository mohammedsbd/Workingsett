import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AllConfigType } from '../config/config.type';
import { ParsimApiKeysService } from '../parsim-api-keys/parsim-api-keys.service';
import { Project } from '../projects/domain/project';
import { ProjectsService } from '../projects/projects.service';
import { TokenUsage } from '../usage-records/domain/token-usage';
import { UsageRecordsService } from '../usage-records/usage-records.service';
import { parseProxyCredentials } from './proxy-credentials';
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
  gemini: '/v1/chat/completions',
  anthropic: '/v1/messages',
};

type Forward = {
  operation: ProxyOperation;
  project: Project;
  adapter: ProviderAdapter;
  info: RequestInfo;
  prepared: PreparedUpstreamRequest;
  startedAt: number;
};

type Outcome = { status: number; usage: TokenUsage | null };

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
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    this.adapters = new Map(
      adapters.map((a) => [adapterKey(a.api, a.upstream), a]),
    );
  }

  /** Proxies one request for the given endpoint. */
  handle(
    operation: ProxyOperation,
    req: Request,
    res: Response,
  ): Promise<void> {
    const handling = this.run(operation, req, res);
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
  ): Promise<void> {
    const startedAt = performance.now();
    let forward: Forward;
    try {
      forward = await this.prepare(operation, req, startedAt);
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
  ): Promise<Forward> {
    const credentials = parseProxyCredentials(req.headers, operation.api);
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
    const info = readRequestInfo(rawBody);

    const providerKey =
      credentials.providerKey ??
      this.projectsService.storedProviderKey(project);
    if (!providerKey) throw proxyErrors.missingProviderKey();

    return {
      operation,
      project,
      adapter,
      info,
      prepared: adapter.prepare({
        operation,
        rawBody,
        info,
        providerKey,
        clientHeaders: req.headers,
      }),
      startedAt,
    };
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
    { adapter, info, prepared }: Forward,
    req: Request,
    res: Response,
  ): Promise<Outcome> {
    const timeoutMs = this.configService.getOrThrow('proxy.upstreamTimeoutMs', {
      infer: true,
    });
    const abort = new AbortController();
    let timedOut = false;
    let clientGone = false;
    let timer: NodeJS.Timeout | undefined;
    // The timeout covers waiting for headers and every gap between chunks.
    const armTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, timeoutMs);
    };
    const onClose = () => {
      if (!res.writableFinished) {
        clientGone = true;
        abort.abort();
      }
    };
    res.on('close', onClose);

    try {
      armTimer();
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(prepared.url, {
          method: 'POST',
          headers: prepared.headers,
          body: new Uint8Array(prepared.body),
          signal: abort.signal,
        });
      } catch {
        if (clientGone) return { status: CLIENT_CLOSED_REQUEST, usage: null };
        throw timedOut
          ? proxyErrors.upstreamTimeout()
          : proxyErrors.upstreamUnreachable();
      }

      const contentType = upstream.headers.get('content-type') ?? '';
      const isStream =
        info.stream && upstream.ok && contentType.includes('text/event-stream');

      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        if (!HOP_BY_HOP_HEADERS.has(name)) res.setHeader(name, value);
      });

      if (!isStream) {
        let body: Buffer;
        try {
          body = Buffer.from(await upstream.arrayBuffer());
        } catch {
          if (clientGone) return { status: CLIENT_CLOSED_REQUEST, usage: null };
          throw timedOut
            ? proxyErrors.upstreamTimeout()
            : proxyErrors.upstreamUnreachable();
        }
        res.end(body);
        return {
          status: upstream.status,
          usage: upstream.ok
            ? adapter.usageFromResponse(parseJson(body))
            : null,
        };
      }

      return await this.relayStream(
        upstream,
        res,
        adapter,
        prepared,
        armTimer,
        () => (clientGone ? CLIENT_CLOSED_REQUEST : timedOut ? 504 : 502),
      );
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
      req.socket?.setTimeout(0);
    }
  }

  private async relayStream(
    upstream: globalThis.Response,
    res: Response,
    adapter: ProviderAdapter,
    prepared: PreparedUpstreamRequest,
    armTimer: () => void,
    interruptedStatus: () => number,
  ): Promise<Outcome> {
    const filter = new SseStreamFilter(
      (event, previous) => adapter.usageFromStreamEvent(event, previous),
      prepared.usageInjected,
    );
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();

    const reader = upstream.body!.getReader();
    try {
      for (;;) {
        armTimer();
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
      return { status: interruptedStatus(), usage: filter.usage };
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
    try {
      await this.usageRecords.record({
        projectId: forward.project.id,
        upstream: forward.adapter.upstream,
        model: forward.info.model,
        usage: outcome.usage,
        latencyMs,
        status: outcome.status,
        streamed: forward.info.stream,
      });
    } catch (error) {
      this.logger.error(
        `Could not save usage record: ${(error as Error).message}`,
      );
    }
  }
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
