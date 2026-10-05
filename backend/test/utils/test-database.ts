import { DataSource, DataSourceOptions } from 'typeorm';
import { AppDataSource } from '../../src/database/data-source';

/**
 * The e2e suite wipes every table between tests, so it must never touch a
 * database that isn't clearly a test database.
 */
export function assertTestDatabase(): string {
  const name = process.env.DATABASE_NAME;

  if (process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is set. Tests only use DATABASE_HOST/PORT/NAME from .env.test, so remove DATABASE_URL there.',
    );
  }

  if (!name || !name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name ?? ''}". Set DATABASE_NAME to a name ending in _test in backend/.env.test (see .env.test.example).`,
    );
  }

  return name;
}

/** Creates the test database if it does not exist yet. */
export async function ensureTestDatabase(): Promise<void> {
  const name = assertTestDatabase();
  const admin = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT
      ? parseInt(process.env.DATABASE_PORT, 10)
      : 5432,
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: 'postgres',
  });

  await admin.initialize();
  try {
    const rows: unknown[] = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (!rows.length) {
      // Identifiers cannot be bound as parameters; the name is checked above.
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.destroy();
  }
}

/** Runs all pending migrations on the test database. */
export async function migrateTestDatabase(): Promise<void> {
  assertTestDatabase();
  const dataSource = await new DataSource({
    ...AppDataSource.options,
    logging: false,
  } as DataSourceOptions).initialize();
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}

/** Removes all rows from every entity table and resets id sequences. */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  assertTestDatabase();
  const tables = dataSource.entityMetadatas
    .filter((entity) => entity.tableType === 'regular')
    .map((entity) => `"${entity.tableName}"`);

  if (tables.length) {
    await dataSource.query(
      `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
}
