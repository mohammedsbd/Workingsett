import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import { AllConfigType } from '../config/config.type';

/** pg-boss keeps its tables in this schema of the app's database. */
export const JOBS_SCHEMA = 'pgboss';

/**
 * Background jobs on pg-boss, in the app's own Postgres (no Redis). Starts
 * with the app, creating or migrating its schema, and stops gracefully on
 * shutdown. It uses a small pool of its own: pg-boss runs raw SQL that
 * TypeORM's query() would reshape.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private boss?: PgBoss;

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  async onModuleInit(): Promise<void> {
    const db = this.configService.getOrThrow('database', { infer: true });
    const ssl = db.sslEnabled
      ? {
          rejectUnauthorized: db.rejectUnauthorized,
          ca: db.ca ?? undefined,
          key: db.key ?? undefined,
          cert: db.cert ?? undefined,
        }
      : undefined;
    const boss = new PgBoss({
      ...(db.url
        ? { connectionString: db.url }
        : {
            host: db.host,
            port: db.port,
            user: db.username,
            password: db.password,
            database: db.name,
          }),
      ssl,
      schema: JOBS_SCHEMA,
      max: 4,
      application_name: 'parsim-jobs',
    });
    // Errors pg-boss hits in its own loops (never job content).
    boss.on('error', (error) =>
      this.logger.error(`pg-boss error: ${error.name}: ${error.message}`),
    );
    await boss.start();
    this.boss = boss;
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true, wait: true, timeout: 10_000 });
    this.boss = undefined;
  }

  private started(): PgBoss {
    if (!this.boss) throw new Error('The job queue is not started');
    return this.boss;
  }

  createQueue(
    name: string,
    options: Omit<PgBoss.Queue, 'name'> = {},
  ): Promise<void> {
    return this.started().createQueue(name, options);
  }

  send(
    name: string,
    data: object,
    options: PgBoss.SendOptions = {},
  ): Promise<string | null> {
    return this.started().send(name, data, options);
  }

  /** Runs `handler` for each job, one at a time. A throw fails the job (retried up to its retry limit). */
  work<T extends object>(
    name: string,
    options: { pollingIntervalSeconds: number },
    handler: (job: PgBoss.JobWithMetadata<T>) => Promise<void>,
  ): Promise<string> {
    return this.started().work<T>(
      name,
      { ...options, batchSize: 1, includeMetadata: true },
      async (jobs) => {
        for (const job of jobs) await handler(job);
      },
    );
  }
}
