import 'server-only';
import { cookies } from 'next/headers';
import { apiUrl, PROJECT_COOKIE } from './config';
import { TOKEN_COOKIE } from './dev-auth';
import type { Project } from './types';

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in.');
  }
}

/** GET from the backend API (/api/v1) as the signed-in user. */
export async function serverGet<T>(path: string): Promise<T> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) throw new NotSignedInError();
  const res = await fetch(`${apiUrl()}/api/v1${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (res.status === 401) throw new NotSignedInError();
  if (!res.ok) throw new Error(`Parsim API error ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/**
 * The user's projects and the one the dashboard shows: the one saved in
 * the project cookie if it still exists, otherwise the first.
 */
export async function currentProject(): Promise<{
  projects: Project[];
  project: Project | null;
}> {
  const projects = await serverGet<Project[]>('/projects');
  const saved = (await cookies()).get(PROJECT_COOKIE)?.value;
  const project = projects.find((p) => p.id === saved) ?? projects[0] ?? null;
  return { projects, project };
}
