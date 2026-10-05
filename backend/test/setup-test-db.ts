import { ensureTestDatabase, migrateTestDatabase } from './utils/test-database';

/**
 * Creates the test database (DATABASE_NAME from .env.test) if needed and runs
 * the migrations. Used by `npm run test:db:setup` and as the e2e global setup.
 */
export default async function setupTestDatabase(): Promise<void> {
  await ensureTestDatabase();
  await migrateTestDatabase();
}

if (require.main === module) {
  setupTestDatabase()
    .then(() => {
      console.log(`Test database "${process.env.DATABASE_NAME}" is ready.`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
