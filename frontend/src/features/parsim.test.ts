import { describe, expect, it } from 'vitest';
import { queryString } from '@/lib/parsim/client-api';
import type { ProjectSettings } from '@/lib/parsim/types';
import { dailyPath, summaryPath } from './overview/api/service';
import { filtersFrom } from './sessions/api/params';
import { sessionsPath } from './sessions/api/service';
import { settingsSchema, toForm, toUpdate } from './settings/settings-values';
import { setupSnippets } from './setup/snippets';

describe('queryString', () => {
  it('keeps defined values only', () => {
    expect(queryString({ page: 2, search: 'a b', sort: undefined, x: null, y: '' })).toBe(
      '?page=2&search=a+b'
    );
    expect(queryString({})).toBe('');
  });
});

describe('overview paths', () => {
  it('asks for the last N days', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(summaryPath('p1', 7, now)).toBe(
      '/projects/p1/dashboard/summary?from=2026-10-04T12%3A00%3A00.000Z'
    );
    expect(dailyPath('p1', 30, now)).toContain('/projects/p1/dashboard/daily?from=2026-09-11');
  });
});

describe('sessions table state', () => {
  it('maps the table URL state to the API query', () => {
    const filters = filtersFrom({
      page: 3,
      perPage: 50,
      externalId: 'run-42',
      sort: [{ id: 'tokensSaved', desc: false }]
    });
    expect(filters).toEqual({
      page: 3,
      limit: 50,
      search: 'run-42',
      sort: 'tokensSaved',
      order: 'asc'
    });
    expect(sessionsPath('p1', filters)).toBe(
      '/projects/p1/sessions?page=3&limit=50&search=run-42&sort=tokensSaved&order=asc'
    );
  });

  it('defaults to the most recent sessions and caps the page size', () => {
    expect(filtersFrom({ page: 1, perPage: 500, externalId: null, sort: [] })).toEqual({
      page: 1,
      limit: 100,
      search: null,
      sort: 'lastSeenAt',
      order: 'desc'
    });
  });
});

describe('settings form values', () => {
  const settings: ProjectSettings = {
    gcMode: 'shadow',
    storeContent: null,
    storeContentDefault: true,
    thresholds: {
      gcMinContextTokens: { value: null, default: 8000 },
      gcBatchTokens: { value: 2000, default: 4000 },
      gcProtectedTurns: { value: null, default: 6 },
      gcArchiveMinTokens: { value: 0, default: 1500 },
      gcArchiveAfterTurns: { value: null, default: 6 }
    },
    sideEffectTools: { project: ['save_note'], server: [], patterns: ['send_'] },
    recallMaxPerRequest: 3
  };

  it('round-trips the project settings, empty meaning the default', () => {
    const values = toForm(settings);
    expect(values).toMatchObject({
      gcMode: 'shadow',
      storeContent: 'default',
      gcBatchTokens: 2000,
      gcArchiveMinTokens: 0,
      gcMinContextTokens: undefined
    });
    expect(toUpdate(values)).toEqual({
      gcMode: 'shadow',
      storeContent: null,
      gcSideEffectTools: ['save_note'],
      gcMinContextTokens: null,
      gcBatchTokens: 2000,
      gcProtectedTurns: null,
      gcArchiveMinTokens: 0,
      gcArchiveAfterTurns: null
    });
  });

  it('cleans up tool names and maps content storage', () => {
    const update = toUpdate({
      ...toForm(settings),
      storeContent: 'false',
      gcSideEffectTools: [' book_flight ', 'book_flight', '']
    });
    expect(update.storeContent).toBe(false);
    expect(update.gcSideEffectTools).toEqual(['book_flight']);
  });

  it('rejects thresholds the backend would refuse', () => {
    const values = toForm(settings);
    expect(settingsSchema.safeParse({ ...values, gcProtectedTurns: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...values, gcBatchTokens: 1.5 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...values, gcBatchTokens: -1 }).success).toBe(false);
    expect(settingsSchema.safeParse(values).success).toBe(true);
  });
});

describe('setup snippets', () => {
  it('fill in the Parsim endpoint and cover every provider', () => {
    const snippets = setupSnippets('https://parsim.example.com');
    expect(snippets.map((s) => s.id)).toEqual([
      'openai',
      'gemini-openai',
      'gemini-native',
      'anthropic',
      'claude-code'
    ]);
    for (const snippet of snippets) {
      expect(snippet.code).toContain('https://parsim.example.com');
    }
    expect(snippets.find((s) => s.id === 'gemini-native')!.code).toContain(
      "baseUrl: 'https://parsim.example.com'"
    );
  });
});
