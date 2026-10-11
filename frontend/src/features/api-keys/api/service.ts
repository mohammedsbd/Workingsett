import { parsimFetch } from '@/lib/parsim/client-api';
import type { ApiKey, CreatedApiKey } from '@/lib/parsim/types';

export const keysPath = (projectId: string) => `/projects/${projectId}/api-keys`;

export const listKeys = (projectId: string) => parsimFetch<ApiKey[]>(keysPath(projectId));

export const createKey = (projectId: string, name: string) =>
  parsimFetch<CreatedApiKey>(keysPath(projectId), {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {})
  });

export const revokeKey = (projectId: string, keyId: string) =>
  parsimFetch<ApiKey>(`${keysPath(projectId)}/${keyId}/revoke`, { method: 'POST' });
