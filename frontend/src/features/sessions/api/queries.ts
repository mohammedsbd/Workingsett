import { isReplayActive } from '@/lib/parsim/format';
import { getQueryClient } from '@/lib/query-client';
import { mutationOptions, queryOptions } from '@tanstack/react-query';
import {
  estimateReplay,
  getReplayOptions,
  getReplayReport,
  getReplays,
  getSession,
  getSessions,
  startReplay,
  type ReplayRequest,
  type SessionFilters
} from './service';

export const sessionKeys = {
  all: ['sessions'] as const,
  list: (projectId: string, filters: SessionFilters) =>
    [...sessionKeys.all, projectId, 'list', filters] as const,
  detail: (projectId: string, sessionId: string) =>
    [...sessionKeys.all, projectId, 'detail', sessionId] as const,
  replays: (projectId: string, sessionId: string) =>
    [...sessionKeys.detail(projectId, sessionId), 'replays'] as const
};

/** How often a running replay's progress is refreshed. */
const REPLAY_POLL_MS = 2000;

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

export const replayOptionsQueryOptions = (projectId: string, sessionId: string) =>
  queryOptions({
    queryKey: [...sessionKeys.replays(projectId, sessionId), 'options'],
    queryFn: () => getReplayOptions(projectId, sessionId)
  });

export const replayEstimateQueryOptions = (
  projectId: string,
  sessionId: string,
  request: ReplayRequest
) =>
  queryOptions({
    queryKey: [...sessionKeys.replays(projectId, sessionId), 'estimate', request],
    queryFn: () => estimateReplay(projectId, sessionId, request),
    retry: false
  });

export const replaysQueryOptions = (projectId: string, sessionId: string) =>
  queryOptions({
    queryKey: [...sessionKeys.replays(projectId, sessionId), 'list'],
    queryFn: () => getReplays(projectId, sessionId),
    refetchInterval: (query) =>
      query.state.data?.some((r) => isReplayActive(r.status)) ? REPLAY_POLL_MS : false
  });

export const replayReportQueryOptions = (projectId: string, sessionId: string, replayId: string) =>
  queryOptions({
    queryKey: [...sessionKeys.replays(projectId, sessionId), 'report', replayId],
    queryFn: () => getReplayReport(projectId, sessionId, replayId),
    refetchInterval: (query) =>
      query.state.data && isReplayActive(query.state.data.replay.status) ? REPLAY_POLL_MS : false
  });

export const startReplayMutation = (projectId: string, sessionId: string) =>
  mutationOptions({
    mutationFn: (request: ReplayRequest) => startReplay(projectId, sessionId, request),
    onSettled: () =>
      getQueryClient().invalidateQueries({
        queryKey: [...sessionKeys.replays(projectId, sessionId), 'list']
      })
  });
