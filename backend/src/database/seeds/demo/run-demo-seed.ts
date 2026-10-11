import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { generateParsimKey } from '../../../parsim-api-keys/parsim-key';
import { SeedModule } from '../relational/seed.module';
import { buildDemoRows, DemoProjectPlan } from './demo-data';

/**
 * Creates two demo projects for the seeded admin with 30 days of fake
 * usage, so the dashboard has data to show. Development only: refuses to
 * run in production. Running it again replaces the demo projects.
 *
 *   npm run seed:demo
 */
const ADMIN_EMAIL = 'admin@example.com';

type Prices = Record<
  string,
  { input: number; cachedInput?: number; output: number }
>;

const BATCH = 300;

async function insert(
  db: DataSource,
  table: string,
  rows: Record<string, unknown>[],
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .createQueryBuilder()
      .insert()
      .into(table)
      .values(rows.slice(i, i + BATCH))
      .execute();
  }
}

const run = async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed must not run in production.');
  }
  const app = await NestFactory.create(SeedModule, { logger: ['error'] });
  // The app's connection logs every query in development; thousands of
  // inserts would flood the terminal, so the seed uses its own.
  const db = new DataSource({ ...app.get(DataSource).options, logging: false });
  await db.initialize();
  await app.close();

  const [admin] = (await db.query('SELECT id FROM "user" WHERE email = $1', [
    ADMIN_EMAIL,
  ])) as {
    id: number;
  }[];
  if (!admin)
    throw new Error('Run npm run seed:run:relational first (no admin user).');

  const prices = (
    JSON.parse(
      readFileSync(path.resolve('config/model-prices.json'), 'utf8'),
    ) as {
      models: Prices;
    }
  ).models;
  const plans: DemoProjectPlan[] = [
    {
      name: 'Demo research agent',
      upstream: 'gemini',
      gcMode: 'on',
      model: 'gemini-3.8-flash',
      price: prices['gemini-3.8-flash'],
      sessions: 18,
      tools: ['web_search', 'fetch_page', 'read_pdf', 'extract_table'],
      label: 'research',
    },
    {
      name: 'Demo support agent',
      upstream: 'openai',
      gcMode: 'shadow',
      model: 'gpt-4o-mini',
      price: prices['gpt-4o-mini'],
      sessions: 12,
      tools: ['lookup_customer', 'get_order', 'search_kb', 'list_tickets'],
      label: 'support',
    },
  ];

  await db.query(
    'DELETE FROM project WHERE "ownerId" = $1 AND name = ANY($2)',
    [admin.id, plans.map((p) => p.name)],
  );

  const now = new Date();
  let seed = 7;
  for (const plan of plans) {
    const projectId = randomUUID();
    await insert(db, 'project', [
      {
        id: projectId,
        name: plan.name,
        upstream: plan.upstream,
        ownerId: admin.id,
        gcMode: plan.gcMode,
        storeContent: true,
        gcSideEffectTools: [],
      },
    ]);
    const key = generateParsimKey();
    await insert(db, 'parsim_api_key', [
      { projectId, name: 'demo', prefix: key.prefix, keyHash: key.hash },
    ]);

    const rows = buildDemoRows(projectId, plan, seed++, now);
    await insert(db, 'agent_session', rows.sessions);
    await insert(db, 'usage_record', rows.usage);
    await insert(db, 'gc_run', rows.runs);
    await insert(db, 'gc_decision', rows.decisions);
    await insert(db, 'recall', rows.recalls);
    console.log(
      `${plan.name}: ${rows.sessions.length} sessions, ${rows.usage.length} requests, ${rows.decisions.length} decisions, ${rows.recalls.length} recalls`,
    );
  }
  await db.destroy();
};

run().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
