import { mutationOptions, queryOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { createKey, listKeys, revokeKey } from './service';

export const keyKeys = {
  all: ['api-keys'] as const,
  list: (projectId: string) => [...keyKeys.all, projectId] as const
};

export const keysQueryOptions = (projectId: string) =>
  queryOptions({ queryKey: keyKeys.list(projectId), queryFn: () => listKeys(projectId) });

export const createKeyMutation = (projectId: string) =>
  mutationOptions({
    mutationFn: (name: string) => createKey(projectId, name),
    onSettled: () => getQueryClient().invalidateQueries({ queryKey: keyKeys.list(projectId) })
  });

export const revokeKeyMutation = (projectId: string) =>
  mutationOptions({
    mutationFn: (keyId: string) => revokeKey(projectId, keyId),
    onSettled: () => getQueryClient().invalidateQueries({ queryKey: keyKeys.list(projectId) })
  });
