import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { APP_OPTIONS, configureApp } from '../../src/app-setup';
import { AppModule } from '../../src/app.module';
import { RoleSeedService } from '../../src/database/seeds/relational/role/role-seed.service';
import { StatusSeedService } from '../../src/database/seeds/relational/status/status-seed.service';
import { UserSeedService } from '../../src/database/seeds/relational/user/user-seed.service';
import { MailerService } from '../../src/mailer/mailer.service';
import { ProxyService } from '../../src/proxy/proxy.service';
import { RoleEntity } from '../../src/roles/infrastructure/persistence/relational/entities/role.entity';
import { StatusEntity } from '../../src/statuses/infrastructure/persistence/relational/entities/status.entity';
import { UserEntity } from '../../src/users/infrastructure/persistence/relational/entities/user.entity';
import { CapturingLogger } from './capturing-logger';
import { InMemoryMailer } from './in-memory-mailer';
import { assertTestDatabase, truncateAllTables } from './test-database';

export type TestApp = {
  app: NestExpressApplication;
  /** The HTTP server to pass to supertest's `request()`. */
  server: ReturnType<INestApplication['getHttpServer']>;
  dataSource: DataSource;
  mailer: InMemoryMailer;
  /** Every message the app logged, at all levels. */
  logs: CapturingLogger;
  /** Empties every table, re-seeds roles, statuses and users, clears mail. */
  reset: () => Promise<void>;
  /** Starts listening on a random port (for real HTTP clients); returns the URL. */
  listen: () => Promise<string>;
  close: () => Promise<void>;
};

/**
 * Boots the real AppModule in-process with the same global setup as main.ts.
 * Only the SMTP mailer is replaced (an external boundary).
 *
 * `env` overrides environment variables while the app's config is loaded
 * (for example the fake upstream's URL) and restores them afterwards.
 */
export async function createTestApp(
  env: Record<string, string> = {},
): Promise<TestApp> {
  assertTestDatabase();

  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);

  const mailer = new InMemoryMailer();
  const logs = new CapturingLogger();
  let app: NestExpressApplication;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      ...APP_OPTIONS,
      logger: logs,
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  try {
    return await initTestApp(app, mailer, logs);
  } catch (error) {
    // Close what was opened (DB pool) so a failed boot doesn't hang Jest.
    await app.close();
    throw error;
  }
}

async function initTestApp(
  app: NestExpressApplication,
  mailer: InMemoryMailer,
  logs: CapturingLogger,
): Promise<TestApp> {
  configureApp(app);
  await app.init();

  const dataSource = app.get(DataSource);
  const seeds = [
    new RoleSeedService(dataSource.getRepository(RoleEntity)),
    new StatusSeedService(dataSource.getRepository(StatusEntity)),
    new UserSeedService(dataSource.getRepository(UserEntity)),
  ];

  return {
    app,
    server: app.getHttpServer(),
    dataSource,
    mailer,
    logs,
    reset: async () => {
      // Requests from the previous test may still be writing usage records.
      await app.get(ProxyService).whenIdle();
      await truncateAllTables(dataSource);
      for (const seed of seeds) {
        await seed.run();
      }
      mailer.clear();
      logs.clear();
    },
    listen: async () => {
      if (!app.getHttpServer().listening) {
        await app.listen(0, '127.0.0.1');
      }
      return app.getUrl();
    },
    close: () => app.close(),
  };
}
