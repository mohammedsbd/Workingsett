import request from 'supertest';
import { DataSource } from 'typeorm';
import { login } from './auth-helpers';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './constants';
import type { TestApp } from './test-app';

export type TestProject = {
  id: string;
  name: string;
  upstream: string;
  hasProviderKey: boolean;
};

export type ProxyFixture = {
  adminToken: string;
  project: TestProject;
  /** A valid Parsim key for the project. */
  parsimKey: string;
  parsimKeyId: string;
};

/** Logs in as the seeded admin and creates a project with one API key. */
export async function createProjectWithKey(
  t: TestApp,
  options: {
    upstream?: 'openai' | 'gemini' | 'anthropic';
    providerKey?: string;
  } = {},
): Promise<ProxyFixture> {
  const adminToken = (await login(t, ADMIN_EMAIL, ADMIN_PASSWORD)).token;
  const project = await request(t.server)
    .post('/api/v1/projects')
    .auth(adminToken, { type: 'bearer' })
    .send({
      name: 'Test project',
      upstream: options.upstream ?? 'openai',
      ...(options.providerKey && { providerKey: options.providerKey }),
    })
    .expect(201)
    .then(({ body }) => body as TestProject);
  const key = await request(t.server)
    .post(`/api/v1/projects/${project.id}/api-keys`)
    .auth(adminToken, { type: 'bearer' })
    .send({ name: 'test' })
    .expect(201)
    .then(({ body }) => body as { id: string; key: string });

  return { adminToken, project, parsimKey: key.key, parsimKeyId: key.id };
}

/** Polls until `check` returns a value (or throws after `timeoutMs`). */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export type UsageRow = {
  projectId: string;
  agentSessionId: string | null;
  upstream: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  costUsd: string | null;
  latencyMs: number;
  status: number;
  streamed: boolean;
};

/** Waits for the next usage record of a project to be written. */
export function waitForUsageRecords(
  dataSource: DataSource,
  projectId: string,
  count = 1,
): Promise<UsageRow[]> {
  return waitFor(async () => {
    const rows: UsageRow[] = await dataSource.query(
      'SELECT * FROM usage_record WHERE "projectId" = $1 ORDER BY "createdAt"',
      [projectId],
    );
    return rows.length >= count ? rows : null;
  });
}

/**
 * Every row of every entity table as JSON text, to search for secrets.
 * Pass table names in `exclude` to leave them out (for example
 * context_content, which holds content on purpose).
 */
export async function dumpAllTables(
  dataSource: DataSource,
  exclude: string[] = [],
): Promise<string> {
  const dumps: string[] = [];
  for (const entity of dataSource.entityMetadatas) {
    if (exclude.includes(entity.tableName)) continue;
    const rows: { row: string }[] = await dataSource.query(
      `SELECT row_to_json(t)::text AS row FROM "${entity.tableName}" t`,
    );
    dumps.push(...rows.map((r) => r.row));
  }
  return dumps.join('\n');
}

/** A chat request body, as raw text, deliberately formatted unusually. */
export function chatBody(
  fields: Record<string, unknown> = {},
  content = 'Summarize the attached quarterly report.',
): string {
  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content },
    ],
    temperature: 0.2,
    ...fields,
  };
  // Odd spacing and key order, so byte-for-byte forwarding is really tested.
  return JSON.stringify(body, null, 3).replace(/": /g, '" :  ') + '\n';
}
