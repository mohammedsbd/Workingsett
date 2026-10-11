import { parsimFetch } from '@/lib/parsim/client-api';
import type { GcMode, Project, ProjectSettings, ThresholdKey } from '@/lib/parsim/types';

export const settingsPath = (projectId: string) => `/projects/${projectId}/settings`;

export const getSettings = (projectId: string) =>
  parsimFetch<ProjectSettings>(settingsPath(projectId));

export type SettingsUpdate = {
  gcMode: GcMode;
  storeContent: boolean | null;
  gcSideEffectTools: string[];
} & Record<ThresholdKey, number | null>;

export const updateSettings = (projectId: string, update: SettingsUpdate) =>
  parsimFetch<Project>(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(update)
  });
