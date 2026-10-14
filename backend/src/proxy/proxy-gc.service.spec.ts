import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { loadConversation, toOpenAiBody } from '../../test/utils/fixtures';
import { AgentSession } from '../agent-sessions/domain/agent-session';
import { AgentSessionRepository } from '../agent-sessions/infrastructure/persistence/agent-session.repository';
import { ArchivedItemRepository } from '../archived-items/infrastructure/persistence/archived-item.repository';
import { NewArchivedItem } from '../archived-items/infrastructure/persistence/archived-item.repository';
import { CompressionService } from '../compression/compression.service';
import {
  renderStateBlock,
  STATE_BLOCK_START,
} from '../compression/state-block';
import { Compression } from '../compressions/domain/compression';
import {
  CompressionRepository,
  NewCompression,
} from '../compressions/infrastructure/persistence/compression.repository';
import { OpenAiChatConverter } from '../context/normalization/openai-chat.converter';
import { JobsService } from '../jobs/jobs.service';
import { ProjectsService } from '../projects/projects.service';
import { UsageRecordsService } from '../usage-records/usage-records.service';
import { GcDecision } from '../gc-decisions/domain/gc-decision';
import {
  GcDecisionRepository,
  NewGcDecision,
} from '../gc-decisions/infrastructure/persistence/gc-decision.repository';
import { GcRun } from '../gc-runs/domain/gc-run';
import {
  GcRunRepository,
  NewGcRun,
} from '../gc-runs/infrastructure/persistence/gc-run.repository';
import { DEFAULT_GC_CONFIG } from '../gc/gc-config';
import { Project } from '../projects/domain/project';
import { GcRequest, ProxyGcService } from './proxy-gc.service';

/** In-memory stand-ins for the GC tables. */
class Store {
  session: AgentSession | null = null;
  decisions: GcDecision[] = [];
  runs: GcRun[] = [];
  archived: NewArchivedItem[] = [];
  compressions: Compression[] = [];
  jobs: object[] = [];
  failArchive = false;
  failRuns = false;
  failCompressions = false;

  processed: [string, number][] = [];
  sessions: Pick<
    AgentSessionRepository,
    'findByExternalId' | 'markGcProcessed'
  > = {
    findByExternalId: () => Promise.resolve(this.session),
    markGcProcessed: (id: string, position: number) => {
      this.processed.push([id, position]);
      return Promise.resolve();
    },
  };
  decisionRepo: GcDecisionRepository = {
    insertMissing: (rows: NewGcDecision[]) => {
      for (const row of rows) {
        this.decisions.push({
          ...row,
          id: `d${this.decisions.length}`,
          createdAt: new Date(0),
        });
      }
      return Promise.resolve(rows.length);
    },
    findBySession: () => Promise.resolve(this.decisions),
  };
  runRepo: GcRunRepository = {
    create: (run: NewGcRun) => {
      if (this.failRuns) return Promise.reject(new Error('db down'));
      const row = {
        ...run,
        id: `r${this.runs.length}`,
        createdAt: new Date(0),
      };
      this.runs.push(row);
      return Promise.resolve(row);
    },
    findByProject: () => Promise.resolve(this.runs),
  };
  compressionRepo: Pick<
    CompressionRepository,
    'findBySession' | 'createPending'
  > = {
    findBySession: () =>
      this.failCompressions
        ? Promise.reject(new Error('db down'))
        : Promise.resolve(this.compressions),
    createPending: (c: NewCompression) => {
      const row = {
        ...c,
        id: `c${this.compressions.length}`,
        status: 'pending',
      } as Compression;
      this.compressions.push(row);
      return Promise.resolve(row);
    },
  };
  jobsService: Pick<JobsService, 'send'> = {
    send: (_name: string, data: object) => {
      this.jobs.push(data);
      return Promise.resolve('job1');
    },
  };
  archiveRepo: Pick<ArchivedItemRepository, 'insertMissing'> = {
    insertMissing: (items: NewArchivedItem[]) => {
      if (this.failArchive) return Promise.reject(new Error('db down'));
      this.archived.push(...items);
      return Promise.resolve(items.length);
    },
  };
}

const project = { id: 'p1', gcMode: 'on' } as Project;
const compressing = {
  ...project,
  compressionEnabled: true,
  gcSideEffectTools: [] as string[],
  // No new GC decisions, so the state block is what shrinks the stretch.
  gcMinContextTokens: 1_000_000,
} as Project;
const converter = new OpenAiChatConverter();

async function setup() {
  const store = new Store();
  const moduleRef = await Test.createTestingModule({
    providers: [
      ProxyGcService,
      CompressionService,
      { provide: CompressionRepository, useValue: store.compressionRepo },
      { provide: JobsService, useValue: store.jobsService },
      { provide: ProjectsService, useValue: {} },
      { provide: UsageRecordsService, useValue: {} },
      { provide: AgentSessionRepository, useValue: store.sessions },
      { provide: GcDecisionRepository, useValue: store.decisionRepo },
      { provide: GcRunRepository, useValue: store.runRepo },
      { provide: ArchivedItemRepository, useValue: store.archiveRepo },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          gc: {
            ...DEFAULT_GC_CONFIG,
            archiveMinTokens: 500,
            sideEffectTools: ['save_note'],
          },
          compression: { minTokens: 6000 },
        }),
      },
    ],
  }).compile();
  return { service: moduleRef.get(ProxyGcService), store };
}

const input = (rawBody: Buffer, forProject = project): GcRequest => ({
  project: forProject,
  upstream: 'openai',
  converter,
  rawBody,
  sessionHeader: 's1',
});

const research = () =>
  Buffer.from(
    JSON.stringify(toOpenAiBody(loadConversation('research-agent-session'))),
  );

/** A request in on mode, then what happens after its response. */
async function respond(
  service: ProxyGcService,
  request: GcRequest,
  agentSessionId: string | null,
): Promise<void> {
  const evaluation = await service.beforeForward(request);
  await service.afterResponse(request, agentSessionId, evaluation);
}

describe('ProxyGcService', () => {
  it('should forward a smaller request in on mode and store archives first', async () => {
    const { service, store } = await setup();
    const raw = research();

    const evaluation = await service.beforeForward(input(raw));

    expect(evaluation).toMatchObject({
      mode: 'on',
      applied: true,
      error: null,
    });
    expect(evaluation.body.length).toBeLessThan(raw.length / 2);
    const archives = evaluation.result!.decisions.filter(
      (d) => d.decision === 'archive',
    );
    expect(store.archived.map((a) => a.archiveId)).toEqual(
      archives.map((d) => d.archiveId),
    );
    expect(store.archived[0]).toMatchObject({
      projectId: 'p1',
      content: archives[0].original,
    });
  });

  it('should forward the original body when there is nothing to rewrite', async () => {
    const { service, store } = await setup();
    const raw = Buffer.from(
      JSON.stringify(toOpenAiBody(loadConversation('short-chat'))),
    );

    const evaluation = await service.beforeForward(input(raw));

    expect(evaluation.body).toBe(raw);
    expect(evaluation).toMatchObject({ applied: false, error: null });
    expect(store.archived).toEqual([]);
  });

  it('should evaluate in shadow mode without changing the body', async () => {
    const { service, store } = await setup();
    const raw = research();

    const evaluation = await service.shadow(input(raw));

    expect(evaluation.body).toBe(raw);
    expect(evaluation.mode).toBe('shadow');
    expect(evaluation.applied).toBe(false);
    expect(evaluation.result!.decisions.length).toBeGreaterThan(0);
    expect(store.archived).toEqual([]);
  });

  it('should reapply the decisions stored for the session', async () => {
    const { service, store } = await setup();
    const raw = research();
    const first = await service.shadow(input(raw));
    store.session = { id: 'sess1' } as AgentSession;
    await service.record(first, {
      projectId: 'p1',
      agentSessionId: 'sess1',
      usageRecordId: null,
    });

    const second = await service.shadow(input(raw));

    expect(second.result!.decisions.every((d) => d.sticky)).toBe(true);
    expect(second.result!.decisions).toHaveLength(store.decisions.length);
  });

  it('should store where a pass ended and run no new pass until context grows', async () => {
    const { service, store } = await setup();
    const raw = research();
    const first = await service.shadow(input(raw));
    await service.record(first, {
      projectId: 'p1',
      agentSessionId: 'sess1',
      usageRecordId: null,
    });
    expect(first.result!.ran).toBe(true);
    expect(store.processed).toEqual([
      ['sess1', first.result!.processedPosition],
    ]);

    store.session = {
      id: 'sess1',
      gcProcessedPosition: first.result!.processedPosition,
    } as AgentSession;
    const second = await service.shadow(input(raw));
    await service.record(second, {
      projectId: 'p1',
      agentSessionId: 'sess1',
      usageRecordId: null,
    });

    expect(second.result!.ran).toBe(false);
    expect(second.result!.decisions.every((d) => d.sticky)).toBe(true);
    expect(second.result!.request).toEqual(first.result!.request);
    expect(store.processed).toHaveLength(1);
  });

  it('should not archive requests that use a Gemini cachedContent', async () => {
    const { service, store } = await setup();
    const body = JSON.parse(research().toString()) as Record<string, unknown>;
    const raw = Buffer.from(
      JSON.stringify({ ...body, cachedContent: 'cachedContents/abc' }),
    );

    const evaluation = await service.beforeForward(input(raw));

    const decisions = evaluation.result!.decisions;
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => d.decision === 'drop')).toBe(true);
    expect(store.archived).toEqual([]);
  });

  it.each([
    ['the body is not JSON', Buffer.from('{oops'), 'SyntaxError'],
    ['the body is not an object', Buffer.from('[1,2]'), 'TypeError'],
  ])('should fail open when %s', async (_, raw, error) => {
    const { service } = await setup();

    for (const evaluation of [
      await service.beforeForward(input(raw)),
      await service.shadow(input(raw)),
    ]) {
      expect(evaluation).toMatchObject({
        result: null,
        error,
        applied: false,
      });
      expect(evaluation.body).toBe(raw);
    }
  });

  it('should fail open when archived originals cannot be stored', async () => {
    const { service, store } = await setup();
    store.failArchive = true;
    const raw = research();

    const evaluation = await service.beforeForward(input(raw));

    expect(evaluation).toMatchObject({ result: null, error: 'Error' });
    expect(evaluation.body).toBe(raw);
  });

  it('should store the run and only the decisions it made first', async () => {
    const { service, store } = await setup();
    const evaluation = await service.beforeForward(input(research()));
    const ids = { projectId: 'p1', agentSessionId: 's', usageRecordId: 'u' };

    await service.record(evaluation, ids);

    const decisions = evaluation.result!.decisions;
    expect(store.runs).toEqual([
      expect.objectContaining({
        mode: 'on',
        ran: true,
        applied: true,
        failed: false,
        usageRecordId: 'u',
        decisionCount: decisions.length,
        newDecisionCount: decisions.length,
        tokensBefore: evaluation.result!.tokensBefore,
        tokensAfter: evaluation.result!.tokensAfter,
      }),
    ]);
    expect(store.decisions.map((d) => d.itemKey)).toEqual(
      decisions.map((d) => d.itemKey),
    );
    expect(store.decisions[0]).not.toHaveProperty('original');
  });

  it('should store a failed run, and no decisions without a session', async () => {
    const { service, store } = await setup();
    const failed = await service.shadow(input(Buffer.from('nope')));
    const ok = await service.shadow(input(research()));
    const ids = { projectId: 'p1', agentSessionId: null, usageRecordId: null };

    await service.record(failed, ids);
    await service.record(ok, ids);

    expect(store.runs.map((r) => [r.failed, r.error, r.tokensBefore])).toEqual([
      [true, 'SyntaxError', null],
      [false, null, ok.result!.tokensBefore],
    ]);
    expect(store.decisions).toEqual([]);
  });

  it('should never throw when the run cannot be stored', async () => {
    const { service, store } = await setup();
    store.failRuns = true;
    const evaluation = await service.shadow(input(research()));

    await expect(
      service.record(evaluation, {
        projectId: 'p1',
        agentSessionId: 's',
        usageRecordId: null,
      }),
    ).resolves.toBeUndefined();
  });
  describe('compression', () => {
    it('should queue a summary of the next finished stretch after the response', async () => {
      const { service, store } = await setup();

      await respond(service, input(research(), compressing), 'sess1');

      expect(store.compressions).toHaveLength(1);
      expect(store.compressions[0]).toMatchObject({
        projectId: 'p1',
        agentSessionId: 'sess1',
        status: 'pending',
        firstTurn: 1,
      });
      expect(store.jobs).toEqual([{ compressionId: 'c0' }]);

      // One pending summary per session at a time.
      await respond(service, input(research(), compressing), 'sess1');
      expect(store.compressions).toHaveLength(1);
    });

    it('should not queue without compression enabled, in shadow mode or without a session', async () => {
      const { service, store } = await setup();
      await respond(service, input(research()), 'sess1');
      await respond(
        service,
        input(research(), { ...compressing, gcMode: 'shadow' } as Project),
        'sess1',
      );
      await respond(service, input(research(), compressing), null);
      expect(store.compressions).toEqual([]);
    });

    it('should not queue when the GC already shrank the stretch below the minimum', async () => {
      const { service, store } = await setup();
      // The GC drops duplicates and archives the large tool results.
      await respond(
        service,
        input(research(), {
          ...compressing,
          gcMinContextTokens: null,
        } as Project),
        'sess1',
      );
      expect(store.compressions).toEqual([]);
    });

    it('should send the original turns until the block is ready, then the block', async () => {
      const { service, store } = await setup();
      store.session = { id: 'sess1' } as AgentSession;
      await respond(service, input(research(), compressing), 'sess1');

      const pending = await service.beforeForward(
        input(research(), compressing),
      );
      expect(pending.body.toString()).not.toContain(STATE_BLOCK_START);
      expect(pending.compressionSavedTokens ?? 0).toBe(0);

      const c = store.compressions[0];
      Object.assign(c, {
        status: 'ready',
        stateBlock: renderStateBlock({
          summary: { goal: 'g', decisions: [], facts: ['f'], openItems: [] },
          firstTurn: c.firstTurn,
          lastTurn: c.lastTurn,
          actions: c.input!.actions,
          messages: c.input!.messages,
        }),
      });
      const ready = await service.beforeForward(input(research(), compressing));
      const again = await service.beforeForward(input(research(), compressing));

      expect(ready.applied).toBe(true);
      expect(ready.body.toString()).toContain(STATE_BLOCK_START);
      expect(ready.body.length).toBeLessThan(pending.body.length);
      expect(ready.compressionSavedTokens).toBeGreaterThan(0);
      expect(ready.result!.tokensAfter).toBe(
        pending.result!.tokensAfter - ready.compressionSavedTokens!,
      );
      // Byte-identical on every later request.
      expect(again.body.equals(ready.body)).toBe(true);
    });

    it('should fail open to the GC result when state blocks cannot be loaded', async () => {
      const { service, store } = await setup();
      store.session = { id: 'sess1' } as AgentSession;
      store.failCompressions = true;

      const evaluation = await service.beforeForward(
        input(research(), {
          ...compressing,
          gcMinContextTokens: null,
        } as Project),
      );

      expect(evaluation).toMatchObject({ applied: true, error: null });
      expect(evaluation.compressionSavedTokens).toBe(0);
    });
  });
});
