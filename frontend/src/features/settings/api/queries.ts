import { mutationOptions, queryOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { getSettings, updateSettings, type SettingsUpdate } from './service';

export const settingsKeys = {
  all: ['settings'] as const,
  detail: (projectId: string) => [...settingsKeys.all, projectId] as const
};

export const settingsQueryOptions = (projectId: string) =>
  queryOptions({ queryKey: settingsKeys.detail(projectId), queryFn: () => getSettings(projectId) });

export const updateSettingsMutation = (projectId: string) =>
  mutationOptions({
    mutationFn: (update: SettingsUpdate) => updateSettings(projectId, update),
    onSettled: () => {
      const client = getQueryClient();
      void client.invalidateQueries({ queryKey: settingsKeys.detail(projectId) });
      void client.invalidateQueries({ queryKey: ['overview', projectId] });
    }
  });
