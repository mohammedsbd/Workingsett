import { queryOptions } from '@tanstack/react-query';
import { getSession, getSessions, type SessionFilters } from './service';

export const sessionKeys = {
  all: ['sessions'] as const,
  list: (projectId: string, filters: SessionFilters) =>
    [...sessionKeys.all, projectId, 'list', filters] as const,
  detail: (projectId: string, sessionId: string) =>
    [...sessionKeys.all, projectId, 'detail', sessionId] as const
};

export const sessionsQueryOptions = (projectId: string, filters: SessionFilters) =>
  queryOptions({
    queryKey: sessionKeys.list(projectId, filters),
    queryFn: () => getSessions(projectId, filters)
  });

export const sessionQueryOptions = (projectId: string, sessionId: string) =>
  queryOptions({
    queryKey: sessionKeys.detail(projectId, sessionId),
    queryFn: () => getSession(projectId, sessionId)
  });
