import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ArchivedItem } from '../archived-items/domain/archived-item';
import { ArchivedItemRepository } from '../archived-items/infrastructure/persistence/archived-item.repository';
import { addUsage } from '../proxy/proxy.service';
import {
  NewRecall,
  RecallRepository,
} from '../recalls/infrastructure/persistence/recall.repository';
import { planRecallRound } from './recall-limit';
import { RECALL_LIMIT_REACHED } from './recall-tool';
import { RecallService } from './recall.service';

const archived = {
  projectId: 'p1',
  archiveId: 'arc_found',
  tokenCount: 912,
  content: {
    kind: 'tool_result',
    parts: [
      {
        type: 'tool_result',
        isError: false,
        content: [{ type: 'text', text: 'THE ORIGINAL' }],
      },
    ],
  },
} as ArchivedItem;

async function setup(
  options: { failLookup?: boolean; failStore?: boolean } = {},
) {
  const stored: NewRecall[] = [];
  const lookups: [string, string][] = [];
  const moduleRef = await Test.createTestingModule({
    providers: [
      RecallService,
      {
        provide: ArchivedItemRepository,
        useValue: {
          findByArchiveId: (projectId: string, archiveId: string) => {
            lookups.push([projectId, archiveId]);
            if (options.failLookup) return Promise.reject(new Error('down'));
            return Promise.resolve(
              projectId === 'p1' && archiveId === 'arc_found' ? archived : null,
            );
          },
        },
      },
      {
        provide: RecallRepository,
        useValue: {
          createMany: (rows: NewRecall[]) => {
            if (options.failStore) return Promise.reject(new Error('down'));
            stored.push(...rows);
            return Promise.resolve();
          },
        },
      },
    ],
  }).compile();
  return { service: moduleRef.get(RecallService), stored, lookups };
}

const call = (archiveId: string, id = archiveId) => ({ id, archiveId });

describe('RecallService', () => {
  it('should answer found, missing, empty and refused calls in order', async () => {
    const { service, lookups } = await setup();
    const round = planRecallRound(
      [call('arc_found'), call('arc_missing'), call('', 'c3'), call('arc_x')],
      0,
      3,
    );

    const { results, log } = await service.resolve('p1', round);

    expect(results.map((r) => [r.call.id, r.text])).toEqual([
      ['arc_found', 'THE ORIGINAL'],
      [
        'arc_missing',
        'Archive id arc_missing was not found. Continue without it.',
      ],
      ['c3', expect.stringContaining('No archive id was given') as unknown],
      ['arc_x', RECALL_LIMIT_REACHED],
    ]);
    expect(log).toEqual([
      {
        archiveId: 'arc_found',
        found: true,
        refused: false,
        tokensRestored: 912,
      },
      {
        archiveId: 'arc_missing',
        found: false,
        refused: false,
        tokensRestored: 0,
      },
      { archiveId: '', found: false, refused: false, tokensRestored: 0 },
      { archiveId: 'arc_x', found: false, refused: true, tokensRestored: 0 },
    ]);
    // An empty id is never looked up, and refused calls are not either.
    expect(lookups).toEqual([
      ['p1', 'arc_found'],
      ['p1', 'arc_missing'],
    ]);
  });

  it('should only find archives of the same project', async () => {
    const { service } = await setup();
    const { log } = await service.resolve(
      'other-project',
      planRecallRound([call('arc_found')], 0, 3),
    );
    expect(log[0].found).toBe(false);
  });

  it('should answer "not found" when the archive cannot be read', async () => {
    const { service } = await setup({ failLookup: true });
    const { results } = await service.resolve(
      'p1',
      planRecallRound([call('arc_found')], 0, 3),
    );
    expect(results[0].text).toContain('was not found');
  });

  it('should store the recalls with the request ids, and never throw', async () => {
    const ok = await setup();
    const ids = { projectId: 'p1', agentSessionId: 's1', usageRecordId: 'u1' };
    const entry = {
      archiveId: 'a',
      found: true,
      refused: false,
      tokensRestored: 5,
    };

    await ok.service.record([entry], ids);
    await ok.service.record([], ids);
    expect(ok.stored).toEqual([{ ...entry, ...ids }]);

    const failing = await setup({ failStore: true });
    await expect(failing.service.record([entry], ids)).resolves.toBeUndefined();
  });
});

describe('addUsage', () => {
  const usage = (
    input: number,
    output: number,
    cached: number | null = null,
  ) => ({
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    cacheWriteInputTokens: null,
  });

  it('should sum the calls of one request', () => {
    expect(addUsage(usage(10, 2, 4), usage(30, 5))).toEqual({
      inputTokens: 40,
      outputTokens: 7,
      cachedInputTokens: 4,
      cacheWriteInputTokens: null,
    });
    expect(
      addUsage(
        { ...usage(1, 1), cacheWrite1hInputTokens: 2 },
        { ...usage(1, 1), cacheWriteInputTokens: 3 },
      ),
    ).toMatchObject({ cacheWriteInputTokens: 3, cacheWrite1hInputTokens: 2 });
  });

  it('should keep the known usage when the other is missing', () => {
    expect(addUsage(null, usage(1, 2))).toEqual(usage(1, 2));
    expect(addUsage(usage(1, 2), null)).toEqual(usage(1, 2));
    expect(addUsage(null, null)).toBeNull();
  });
});
