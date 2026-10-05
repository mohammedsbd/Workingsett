import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { useContainer } from 'class-validator';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AllConfigType } from '../../src/config/config.type';
import { RoleSeedService } from '../../src/database/seeds/relational/role/role-seed.service';
import { StatusSeedService } from '../../src/database/seeds/relational/status/status-seed.service';
import { UserSeedService } from '../../src/database/seeds/relational/user/user-seed.service';
import { MailerService } from '../../src/mailer/mailer.service';
import { RoleEntity } from '../../src/roles/infrastructure/persistence/relational/entities/role.entity';
import { StatusEntity } from '../../src/statuses/infrastructure/persistence/relational/entities/status.entity';
import { UserEntity } from '../../src/users/infrastructure/persistence/relational/entities/user.entity';
import { ResolvePromisesInterceptor } from '../../src/utils/serializer.interceptor';
import validationOptions from '../../src/utils/validation-options';
import { InMemoryMailer } from './in-memory-mailer';
import { assertTestDatabase, truncateAllTables } from './test-database';

export type TestApp = {
  app: INestApplication;
  /** The HTTP server to pass to supertest's `request()`. */
  server: ReturnType<INestApplication['getHttpServer']>;
  dataSource: DataSource;
  mailer: InMemoryMailer;
  /** Empties every table, re-seeds roles, statuses and users, clears mail. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Boots the real AppModule in-process with the same global setup as main.ts.
 * Only the SMTP mailer is replaced (an external boundary).
 */
export async function createTestApp(): Promise<TestApp> {
  assertTestDatabase();

  const mailer = new InMemoryMailer();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  try {
    return await initTestApp(app, mailer);
  } catch (error) {
    // Close what was opened (DB pool) so a failed boot doesn't hang Jest.
    await app.close();
    throw error;
  }
}

async function initTestApp(
  app: INestApplication,
  mailer: InMemoryMailer,
): Promise<TestApp> {
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  const configService = app.get(ConfigService<AllConfigType>);
  app.setGlobalPrefix(
    configService.getOrThrow('app.apiPrefix', { infer: true }),
    { exclude: ['/'] },
  );
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new ValidationPipe(validationOptions));
  app.useGlobalInterceptors(
    new ResolvePromisesInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );
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
    reset: async () => {
      await truncateAllTables(dataSource);
      for (const seed of seeds) {
        await seed.run();
      }
      mailer.clear();
    },
    close: () => app.close(),
  };
}
