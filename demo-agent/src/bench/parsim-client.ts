import type { Usage } from '../llm/types.js';
import type { Arm, ParsimRunStats } from './types.js';

/**
 * Parsim's API, as the benchmark uses it: sign in, create or reuse one
 * project per Parsim arm with the right GC mode, make a key, and read a
 * session's usage, recalls and compressions afterwards.
 */

export type ParsimUpstream =
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'openai-compatible';

type Project = { id: string; name: string };

export type SessionRecall = {
  archiveId: string;
  found: boolean;
  tokensRestored: number;
  createdAt: string;
};

export type SessionView = {
  stats: ParsimRunStats;
  recalls: SessionRecall[];
  /** Archived originals by archive id (when the project stores content). */
  archived: Map<string, string>;
};

export class ParsimClient {
  private token = '';

  constructor(
    readonly baseUrl: string,
    private readonly email: string,
    private readonly password: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.token && { authorization: `Bearer ${this.token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(
        `Parsim ${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  }

  async login(): Promise<void> {
    const result = await this.request<{ token: string }>(
      'POST',
      '/auth/email/login',
      { email: this.email, password: this.password },
    );
    this.token = result.token;
  }

  /**
   * The arm's project ("Benchmark: parsim-on (groq)"), created if missing,
   * set to the arm's GC mode, and a new key for this bench.
   */
  async projectForArm(
    arm: Arm,
    label: string,
    upstream: ParsimUpstream,
    upstreamBaseUrl: string | undefined,
    compression: boolean,
  ): Promise<{ projectId: string; key: string }> {
    const name = `Benchmark: ${arm} (${label})`;
    const settings = {
      upstream,
      ...(upstream === 'openai-compatible' && { upstreamBaseUrl }),
      gcMode: arm === 'parsim-on' ? 'on' : 'shadow',
      storeContent: true,
      compressionEnabled: arm === 'parsim-on' && compression,
    };
    const projects = await this.request<Project[]>('GET', '/projects');
    let project = projects.find((p) => p.name === name);
    if (project) {
      await this.request('PATCH', `/projects/${project.id}`, settings);
    } else {
      project = await this.request<Project>('POST', '/projects', {
        name,
        ...settings,
      });
    }
    const key = await this.request<{ key: string }>(
      'POST',
      `/projects/${project.id}/api-keys`,
      { name: `bench ${new Date().toISOString()}` },
    );
    return { projectId: project.id, key: key.key };
  }

  /** Parsim's record of one session (one arm run). Null if it has none. */
  async session(
    projectId: string,
    sessionId: string,
  ): Promise<SessionView | null> {
    const list = await this.request<{
      data: { id: string; externalId: string }[];
    }>(
      'GET',
      `/projects/${projectId}/sessions?limit=100&search=${encodeURIComponent(sessionId)}`,
    );
    const row = list.data.find((s) => s.externalId === sessionId);
    if (!row) return null;
    const detail = await this.request<{
      requests: {
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number | null;
        upstreamCalls: number;
        gc: { tokensBefore: number | null; tokensAfter: number | null } | null;
      }[];
      recalls: SessionRecall[];
      decisions: {
        archiveId: string | null;
        content?: {
          parts: { type: string; text?: string; content?: unknown }[];
        } | null;
      }[];
      compressions?: { costUsd: number | null }[];
    }>('GET', `/projects/${projectId}/sessions/${row.id}`);
    const usage: Usage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    };
    let upstreamCalls = 0;
    let gcTokensSaved = 0;
    for (const r of detail.requests) {
      usage.inputTokens += r.inputTokens;
      usage.outputTokens += r.outputTokens;
      usage.cachedInputTokens += r.cachedInputTokens ?? 0;
      upstreamCalls += r.upstreamCalls;
      if (r.gc?.tokensBefore != null && r.gc.tokensAfter != null) {
        gcTokensSaved += r.gc.tokensBefore - r.gc.tokensAfter;
      }
    }
    const archived = new Map<string, string>();
    for (const d of detail.decisions) {
      if (d.archiveId && d.content) {
        archived.set(d.archiveId, JSON.stringify(d.content));
      }
    }
    return {
      stats: {
        usage,
        upstreamCalls,
        recalls: detail.recalls.length,
        compressionCostUsd: (detail.compressions ?? []).reduce(
          (sum, c) => sum + (c.costUsd ?? 0),
          0,
        ),
        gcTokensSaved,
      },
      recalls: detail.recalls,
      archived,
    };
  }
}
