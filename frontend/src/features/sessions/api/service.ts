import { parsimFetch, queryString } from '@/lib/parsim/client-api';
import type {
  Paged,
  ReplayEstimate,
  ReplayOptions,
  ReplayReport,
  ReplaySummary,
  SessionDetail,
  SessionRow
} from '@/lib/parsim/types';

export const SORTABLE = ['lastSeenAt', 'firstSeenAt', 'requestCount', 'tokensSaved'] as const;
export type SessionSort = (typeof SORTABLE)[number];

export type SessionFilters = {
  page: number;
  limit: number;
  search?: string | null;
  sort?: SessionSort;
  order?: 'asc' | 'desc';
};

export function sessionsPath(projectId: string, filters: SessionFilters): string {
  return `/projects/${projectId}/sessions${queryString({
    page: filters.page,
    limit: filters.limit,
    search: filters.search,
    sort: filters.sort,
    order: filters.order
  })}`;
}

export const sessionPath = (projectId: string, sessionId: string) =>
  `/projects/${projectId}/sessions/${sessionId}`;

export const getSessions = (projectId: string, filters: SessionFilters) =>
  parsimFetch<Paged<SessionRow>>(sessionsPath(projectId, filters));

export const getSession = (projectId: string, sessionId: string) =>
  parsimFetch<SessionDetail>(sessionPath(projectId, sessionId));

/** Request points and budget of a replay; both default on the server. */
export type ReplayRequest = { requestNumbers?: number[]; budgetUsd?: number };

export const replaysPath = (projectId: string, sessionId: string) =>
  `${sessionPath(projectId, sessionId)}/replays`;

export const getReplayOptions = (projectId: string, sessionId: string) =>
  parsimFetch<ReplayOptions>(`${replaysPath(projectId, sessionId)}/options`);

/** The cost estimate. Sends nothing to the provider. */
export const estimateReplay = (projectId: string, sessionId: string, body: ReplayRequest) =>
  parsimFetch<ReplayEstimate>(`${replaysPath(projectId, sessionId)}/estimate`, {
    method: 'POST',
    body: JSON.stringify(body)
  });

export const startReplay = (projectId: string, sessionId: string, body: ReplayRequest) =>
  parsimFetch<ReplaySummary>(replaysPath(projectId, sessionId), {
    method: 'POST',
    body: JSON.stringify(body)
  });

export const getReplays = (projectId: string, sessionId: string) =>
  parsimFetch<ReplaySummary[]>(replaysPath(projectId, sessionId));

export const getReplayReport = (projectId: string, sessionId: string, replayId: string) =>
  parsimFetch<ReplayReport>(`${replaysPath(projectId, sessionId)}/${replayId}`);
