import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AllConfigType } from '../config/config.type';
import { CanonicalContent } from '../context/context-items';
import { Project } from '../projects/domain/project';
import { ProjectsService } from '../projects/projects.service';
import { ModelPricingService } from '../usage-records/pricing/model-pricing.service';
import {
  DailySavings,
  Paged,
  ProjectSettings,
  Savings,
  SavingsSummary,
  SessionDetail,
  SessionRow,
  TimelineCompression,
  TimelineDecision,
  TimelineRequest,
} from './dashboard.types';
import { escapeLike, parseRange, utcDays } from './dashboard-query';
import {
  DateRangeQueryDto,
  SessionSort,
  SessionsQueryDto,
} from './dto/dashboard-query.dto';

const SORT_COLUMNS: Record<SessionSort, string> = {
  lastSeenAt: 's."lastSeenAt"',
  firstSeenAt: 's."firstSeenAt"',
  requestCount: 's."requestCount"',
  tokensSaved: '"tokensSaved"',
};

/**
 * usage_record.createdAt is a timestamp without time zone holding the
 * database session's local time, while node-postgres sends a Date with
 * Node's own UTC offset. Comparing them directly drops that offset, so the
 * bounds are read as instants and converted to the session's local time
 * first. The column stays bare so its index still applies.
 */
const USAGE_IN_RANGE = `"createdAt" >= $2::timestamptz::timestamp AND "createdAt" < $3::timestamptz::timestamp`;

/** Postgres returns bigint sums and numerics as strings. */
const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const iso = (value: unknown): string => new Date(value as string).toISOString();

const noSavings = (): Savings => ({ tokensSaved: 0, dollarsSaved: 0 });

/**
 * Read-only views for the dashboard. Every method first checks that the
 * project belongs to the user (404 otherwise). Content is only returned by
 * the session detail, and only when the project stores content.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly projects: ProjectsService,
    private readonly pricing: ModelPricingService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async summary(
    ownerId: number,
    projectId: string,
    query: DateRangeQueryDto,
  ): Promise<SavingsSummary> {
    const project = await this.projects.findOwned(ownerId, projectId);
    const range = parseRange(query, await this.dbNow());
    const params = [project.id, range.from, range.to];

    const [usage] = (await this.db.query(
      `SELECT count(*) FILTER (WHERE kind = 'proxy') AS requests,
              coalesce(sum("inputTokens") FILTER (WHERE kind = 'proxy'), 0) AS input,
              coalesce(sum("outputTokens") FILTER (WHERE kind = 'proxy'), 0) AS output,
              coalesce(sum("cachedInputTokens") FILTER (WHERE kind = 'proxy'), 0) AS cached,
              coalesce(sum("costUsd") FILTER (WHERE kind = 'proxy'), 0) AS cost,
              coalesce(sum("upstreamCalls") FILTER (WHERE kind = 'proxy'), 0) AS calls,
              count(*) FILTER (WHERE kind = 'compression') AS summaries,
              coalesce(sum("costUsd") FILTER (WHERE kind = 'compression'), 0) AS "compressionCost"
         FROM usage_record
        WHERE "projectId" = $1 AND ${USAGE_IN_RANGE}`,
      params,
    )) as Record<string, unknown>[];

    const savings = await this.savingsByModel(params);
    const gc = { runs: 0, tokensBefore: 0, tokensAfter: 0 };
    const applied = noSavings();
    const estimated = noSavings();
    for (const row of savings) {
      gc.runs += row.runs;
      gc.tokensBefore += row.tokensBefore;
      gc.tokensAfter += row.tokensAfter;
      this.add(row.mode === 'on' ? applied : estimated, row);
    }

    const [compressed] = (await this.db.query(
      `SELECT coalesce(sum("compressionSavedTokens"), 0) AS saved
         FROM gc_run
        WHERE "projectId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
          AND mode = 'on' AND NOT failed`,
      params,
    )) as Record<string, unknown>[];
    const compressionCostUsd = num(usage.compressionCost);

    const [recalls] = (await this.db.query(
      `SELECT count(*) AS count,
              count(*) FILTER (WHERE found) AS found,
              coalesce(sum("tokensRestored"), 0) AS restored
         FROM recall
        WHERE "projectId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3`,
      params,
    )) as Record<string, unknown>[];

    const reasons = (await this.db.query(
      `SELECT d.reason, count(*) AS count
         FROM gc_decision d
         JOIN gc_run r ON r.id = d."gcRunId"
        WHERE r."projectId" = $1 AND d."createdAt" >= $2 AND d."createdAt" < $3
        GROUP BY d.reason`,
      params,
    )) as { reason: string; count: string }[];
    const byReason = { duplicate: 0, superseded: 0, stale_large: 0 };
    for (const row of reasons) {
      if (row.reason in byReason) {
        byReason[row.reason as keyof typeof byReason] = num(row.count);
      }
    }

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      mode: project.gcMode,
      requests: num(usage.requests),
      inputTokens: num(usage.input),
      outputTokens: num(usage.output),
      cachedInputTokens: num(usage.cached),
      costUsd: num(usage.cost),
      upstreamCalls: num(usage.calls),
      gc: {
        ...gc,
        reduction: gc.tokensBefore
          ? (gc.tokensBefore - gc.tokensAfter) / gc.tokensBefore
          : 0,
        applied: round(applied),
        estimated: round(estimated),
      },
      compression: {
        summaries: num(usage.summaries),
        tokensSaved: num(compressed.saved),
        costUsd: roundUsd(compressionCostUsd),
      },
      netDollarsSaved: roundUsd(applied.dollarsSaved - compressionCostUsd),
      recalls: {
        count: num(recalls.count),
        found: num(recalls.found),
        tokensRestored: num(recalls.restored),
      },
      decisionsByReason: byReason,
    };
  }

  /**
   * One entry per UTC day of the range. usage_record.createdAt has no time
   * zone (it holds the server's local time), so both tables are cast to
   * timestamptz before bucketing by UTC day.
   */
  async daily(
    ownerId: number,
    projectId: string,
    query: DateRangeQueryDto,
  ): Promise<DailySavings[]> {
    const project = await this.projects.findOwned(ownerId, projectId);
    const range = parseRange(query, await this.dbNow());
    const params = [project.id, range.from, range.to];

    const days = new Map<string, DailySavings>();
    for (const date of utcDays(range)) {
      days.set(date, {
        date,
        requests: 0,
        costUsd: 0,
        compressionCostUsd: 0,
        tokensBefore: 0,
        tokensAfter: 0,
        applied: noSavings(),
        estimated: noSavings(),
      });
    }

    const usage = (await this.db.query(
      `SELECT to_char(date_trunc('day', "createdAt"::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              count(*) FILTER (WHERE kind = 'proxy') AS requests,
              coalesce(sum("costUsd") FILTER (WHERE kind = 'proxy'), 0) AS cost,
              coalesce(sum("costUsd") FILTER (WHERE kind = 'compression'), 0) AS "compressionCost"
         FROM usage_record
        WHERE "projectId" = $1 AND ${USAGE_IN_RANGE}
        GROUP BY day`,
      params,
    )) as {
      day: string;
      requests: string;
      cost: string;
      compressionCost: string;
    }[];
    for (const row of usage) {
      const day = days.get(row.day);
      if (!day) continue;
      day.requests = num(row.requests);
      day.costUsd = num(row.cost);
      day.compressionCostUsd = num(row.compressionCost);
    }

    for (const row of await this.savingsByModel(params, true)) {
      const day = days.get(row.day!);
      if (!day) continue;
      day.tokensBefore += row.tokensBefore;
      day.tokensAfter += row.tokensAfter;
      this.add(row.mode === 'on' ? day.applied : day.estimated, row);
    }
    return [...days.values()].map((day) => ({
      ...day,
      costUsd: roundUsd(day.costUsd),
      compressionCostUsd: roundUsd(day.compressionCostUsd),
      applied: round(day.applied),
      estimated: round(day.estimated),
    }));
  }

  async sessions(
    ownerId: number,
    projectId: string,
    query: SessionsQueryDto,
  ): Promise<Paged<SessionRow>> {
    const project = await this.projects.findOwned(ownerId, projectId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort = SORT_COLUMNS[query.sort ?? 'lastSeenAt'];
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const search = query.search?.trim()
      ? `%${escapeLike(query.search.trim())}%`
      : null;

    const where = `s."projectId" = $1 AND ($2::text IS NULL OR s."externalId" ILIKE $2 OR s.model ILIKE $2)`;
    const [{ total }] = (await this.db.query(
      `SELECT count(*) AS total FROM agent_session s WHERE ${where}`,
      [project.id, search],
    )) as { total: string }[];

    const rows = (await this.db.query(
      `SELECT s.*,
              coalesce(g.saved, 0) AS "tokensSaved",
              coalesce(d.count, 0) AS decisions,
              coalesce(c.count, 0) AS recalls
         FROM agent_session s
         LEFT JOIN (SELECT "agentSessionId", sum("tokensBefore" - "tokensAfter") AS saved
                      FROM gc_run WHERE NOT failed GROUP BY "agentSessionId") g
                ON g."agentSessionId" = s.id
         LEFT JOIN (SELECT "agentSessionId", count(*) AS count
                      FROM gc_decision GROUP BY "agentSessionId") d
                ON d."agentSessionId" = s.id
         LEFT JOIN (SELECT "agentSessionId", count(*) AS count
                      FROM recall GROUP BY "agentSessionId") c
                ON c."agentSessionId" = s.id
        WHERE ${where}
        ORDER BY ${sort} ${order}, s.id
        LIMIT $3 OFFSET $4`,
      [project.id, search, limit, (page - 1) * limit],
    )) as Record<string, unknown>[];

    return {
      data: rows.map((row) => ({
        ...sessionFields(row),
        tokensSaved: num(row.tokensSaved),
        decisions: num(row.decisions),
        recalls: num(row.recalls),
      })),
      total: num(total),
      page,
      limit,
    };
  }

  async session(
    ownerId: number,
    projectId: string,
    sessionId: string,
  ): Promise<SessionDetail> {
    const project = await this.projects.findOwned(ownerId, projectId);
    const [session] = (await this.db.query(
      `SELECT * FROM agent_session WHERE id = $1 AND "projectId" = $2`,
      [sessionId, project.id],
    )) as Record<string, unknown>[];
    if (!session) throw new NotFoundException();

    const requests = (await this.db.query(
      `SELECT u.*, r.mode AS "gcMode", r.ran, r.applied, r.failed,
              r."tokensBefore" AS "gcTokensBefore", r."tokensAfter" AS "gcTokensAfter",
              r."decisionCount", r."newDecisionCount", r.id AS "gcRunId"
         FROM usage_record u
         LEFT JOIN gc_run r ON r."usageRecordId" = u.id
        WHERE u."agentSessionId" = $1 AND u.kind = 'proxy'
        ORDER BY u."createdAt"`,
      [sessionId],
    )) as Record<string, unknown>[];

    const contentAllowed = this.storesContent(project);
    const decisions = (await this.db.query(
      `SELECT d.*${contentAllowed ? ', c.content' : ''}
         FROM gc_decision d
         ${
           contentAllowed
             ? 'LEFT JOIN context_content c ON c."projectId" = $2 AND c.hash = d."contentHash"'
             : ''
         }
        WHERE d."agentSessionId" = $1
        ORDER BY d.position, d."createdAt"`,
      contentAllowed ? [sessionId, project.id] : [sessionId],
    )) as Record<string, unknown>[];

    const recalls = (await this.db.query(
      `SELECT * FROM recall WHERE "agentSessionId" = $1 ORDER BY "createdAt"`,
      [sessionId],
    )) as Record<string, unknown>[];

    const compressions = (await this.db.query(
      `SELECT c.id, c.status, c."firstTurn", c."lastTurn", c."tokensBefore",
              c."tokensAfter", c.error, c."createdAt", c."readyAt",
              u."costUsd"${contentAllowed ? ', c."stateBlock"' : ''}
         FROM compression c
         LEFT JOIN usage_record u ON u.id = c."usageRecordId"
        WHERE c."agentSessionId" = $1
        ORDER BY c."startIndex"`,
      [sessionId],
    )) as Record<string, unknown>[];

    return {
      session: sessionFields(session),
      contentAllowed,
      requests: requests.map(
        (r): TimelineRequest => ({
          id: r.id as string,
          createdAt: iso(r.createdAt),
          model: r.model as string,
          status: num(r.status),
          streamed: r.streamed as boolean,
          latencyMs: num(r.latencyMs),
          inputTokens: num(r.inputTokens),
          outputTokens: num(r.outputTokens),
          cachedInputTokens: numOrNull(r.cachedInputTokens),
          costUsd: numOrNull(r.costUsd),
          upstreamCalls: num(r.upstreamCalls),
          gc: r.gcRunId
            ? {
                mode: r.gcMode as string,
                ran: r.ran as boolean,
                applied: r.applied as boolean,
                failed: r.failed as boolean,
                tokensBefore: numOrNull(r.gcTokensBefore),
                tokensAfter: numOrNull(r.gcTokensAfter),
                decisionCount: num(r.decisionCount),
                newDecisionCount: num(r.newDecisionCount),
              }
            : null,
        }),
      ),
      decisions: decisions.map(
        (d): TimelineDecision => ({
          position: num(d.position),
          toolName: d.toolName as string,
          toolCallId: (d.toolCallId as string | null) ?? null,
          decision: d.decision as string,
          reason: d.reason as string,
          detail: d.detail as string,
          tokensBefore: num(d.tokensBefore),
          tokensAfter: num(d.tokensAfter),
          replacement: d.replacement as string,
          archiveId: (d.archiveId as string | null) ?? null,
          createdAt: iso(d.createdAt),
          ...(contentAllowed && {
            content: (d.content as CanonicalContent | null) ?? null,
          }),
        }),
      ),
      recalls: recalls.map((r) => ({
        archiveId: r.archiveId as string,
        found: r.found as boolean,
        refused: r.refused as boolean,
        tokensRestored: num(r.tokensRestored),
        createdAt: iso(r.createdAt),
      })),
      compressions: compressions.map(
        (c): TimelineCompression => ({
          id: c.id as string,
          status: c.status as string,
          firstTurn: num(c.firstTurn),
          lastTurn: num(c.lastTurn),
          tokensBefore: num(c.tokensBefore),
          tokensAfter: numOrNull(c.tokensAfter),
          costUsd: numOrNull(c.costUsd),
          error: (c.error as string | null) ?? null,
          createdAt: iso(c.createdAt),
          readyAt: c.readyAt ? iso(c.readyAt) : null,
          ...(contentAllowed && {
            stateBlock: (c.stateBlock as string | null) ?? null,
          }),
        }),
      ),
    };
  }

  async settings(ownerId: number, projectId: string): Promise<ProjectSettings> {
    const project = await this.projects.findOwned(ownerId, projectId);
    const gc = this.configService.getOrThrow('gc', { infer: true });
    const compression = this.configService.getOrThrow('compression', {
      infer: true,
    });
    const replay = this.configService.getOrThrow('replay', { infer: true });
    const setting = (value: number | null, fallback: number) => ({
      value,
      default: fallback,
    });
    return {
      gcMode: project.gcMode,
      storeContent: project.storeContent,
      storeContentDefault: this.configService.getOrThrow(
        'proxy.storeContentDefault',
        { infer: true },
      ),
      thresholds: {
        gcMinContextTokens: setting(
          project.gcMinContextTokens,
          gc.minContextTokens,
        ),
        gcBatchTokens: setting(project.gcBatchTokens, gc.batchTokens),
        gcProtectedTurns: setting(project.gcProtectedTurns, gc.protectedTurns),
        gcArchiveMinTokens: setting(
          project.gcArchiveMinTokens,
          gc.archiveMinTokens,
        ),
        gcArchiveAfterTurns: setting(
          project.gcArchiveAfterTurns,
          gc.archiveAfterTurns,
        ),
      },
      sideEffectTools: {
        project: project.gcSideEffectTools,
        server: [...gc.sideEffectTools],
        patterns: [...gc.sideEffectPatterns],
      },
      recallMaxPerRequest: this.configService.getOrThrow(
        'proxy.recallMaxPerRequest',
        { infer: true },
      ),
      compression: {
        enabled: project.compressionEnabled,
        keySource: project.compressionKeySource,
        model: project.compressionModel,
        minTokens: compression.minTokens,
        internalModelConfigured: Boolean(
          compression.internal.model && compression.internal.apiKey,
        ),
      },
      replay: {
        judgeKeySource: project.replayJudgeKeySource,
        judgeModel: project.replayJudgeModel,
        internalJudgeModel: replay.judgeModel || compression.internal.model,
        internalModelConfigured: Boolean(
          (replay.judgeModel || compression.internal.model) &&
          compression.internal.apiKey,
        ),
        defaultBudgetUsd: replay.defaultBudgetUsd,
        maxBudgetUsd: replay.maxBudgetUsd,
      },
    };
  }

  /**
   * The database's current time, rounded up past the current millisecond.
   * Rows get their createdAt from the database's now(), so measuring "now"
   * on the same clock keeps every committed row inside a default range even
   * when Node's clock lags. A JS Date has no microseconds, hence the bump.
   */
  private async dbNow(): Promise<Date> {
    const [{ now }] = (await this.db.query(
      `SELECT date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond' AS now`,
    )) as { now: Date }[];
    return now;
  }

  /** GC savings grouped by model and mode (and day), priced as input. */
  private async savingsByModel(
    params: unknown[],
    byDay = false,
  ): Promise<
    {
      day?: string;
      mode: string;
      runs: number;
      tokensBefore: number;
      tokensAfter: number;
      dollars: number;
    }[]
  > {
    const day = `to_char(date_trunc('day', r."createdAt"::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
    const rows = (await this.db.query(
      `SELECT ${byDay ? `${day} AS day,` : ''} r.mode, u.model,
              count(*) AS runs,
              coalesce(sum(r."tokensBefore"), 0) AS before,
              coalesce(sum(r."tokensAfter"), 0) AS after
         FROM gc_run r
         LEFT JOIN usage_record u ON u.id = r."usageRecordId"
        WHERE r."projectId" = $1 AND r."createdAt" >= $2 AND r."createdAt" < $3
          AND NOT r.failed
        GROUP BY ${byDay ? 'day, ' : ''}r.mode, u.model`,
      params,
    )) as Record<string, unknown>[];
    return rows.map((row) => {
      const saved = num(row.before) - num(row.after);
      const dollars = row.model
        ? (this.pricing.costUsd(row.model as string, {
            inputTokens: saved,
            outputTokens: 0,
            cachedInputTokens: null,
            cacheWriteInputTokens: null,
          }) ?? 0)
        : 0;
      return {
        ...(byDay && { day: row.day as string }),
        mode: row.mode as string,
        runs: num(row.runs),
        tokensBefore: num(row.before),
        tokensAfter: num(row.after),
        dollars,
      };
    });
  }

  private add(
    target: Savings,
    row: { tokensBefore: number; tokensAfter: number; dollars: number },
  ): void {
    target.tokensSaved += row.tokensBefore - row.tokensAfter;
    target.dollarsSaved += row.dollars;
  }

  private storesContent(project: Project): boolean {
    return (
      project.storeContent ??
      this.configService.getOrThrow('proxy.storeContentDefault', {
        infer: true,
      })
    );
  }
}

function sessionFields(row: Record<string, unknown>): SessionDetail['session'] {
  return {
    id: row.id as string,
    externalId: row.externalId as string,
    idSource: row.idSource as string,
    provider: row.provider as string,
    model: row.model as string,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
    requestCount: num(row.requestCount),
  };
}

const roundUsd = (value: number) => Math.round(value * 1e6) / 1e6;

function round(savings: Savings): Savings {
  return { ...savings, dollarsSaved: roundUsd(savings.dollarsSaved) };
}
