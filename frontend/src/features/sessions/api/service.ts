import { parsimFetch, queryString } from '@/lib/parsim/client-api';
import type { Paged, SessionDetail, SessionRow } from '@/lib/parsim/types';

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
