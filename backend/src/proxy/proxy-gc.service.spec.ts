import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { loadConversation, toOpenAiBody } from '../../test/utils/fixtures';
import { AgentSession } from '../agent-sessions/domain/agent-session';
import { AgentSessionRepository } from '../agent-sessions/infrastructure/persistence/agent-session.repository';
import { ArchivedItemRepository } from '../archived-items/infrastructure/persistence/archived-item.repository';
import { NewArchivedItem } from '../archived-items/infrastructure/persistence/archived-item.repository';
import { OpenAiChatConverter } from '../context/normalization/openai-chat.converter';
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
  failArchive = false;
  failRuns = false;

  sessions: Pick<AgentSessionRepository, 'findByExternalId'> = {
    findByExternalId: () => Promise.resolve(this.session),
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
  archiveRepo: Pick<ArchivedItemRepository, 'insertMissing'> = {
    insertMissing: (items: NewArchivedItem[]) => {
      if (this.failArchive) return Promise.reject(new Error('db down'));
      this.archived.push(...items);
      return Promise.resolve(items.length);
    },
  };
}

const project = { id: 'p1', gcMode: 'on' } as Project;
const converter = new OpenAiChatConverter();

async function setup() {
  const store = new Store();
  const moduleRef = await Test.createTestingModule({
    providers: [
      ProxyGcService,
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
        }),
      },
    ],
  }).compile();
  return { service: moduleRef.get(ProxyGcService), store };
}

const input = (rawBody: Buffer): GcRequest => ({
  project,
  upstream: 'openai',
  converter,
  rawBody,
  sessionHeader: 's1',
});

const research = () =>
  Buffer.from(
    JSON.stringify(toOpenAiBody(loadConversation('research-agent-session'))),
  );

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
});
