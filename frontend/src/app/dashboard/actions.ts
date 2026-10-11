'use server';

import { PROJECT_COOKIE } from '@/lib/parsim/config';
import { cookies } from 'next/headers';

/** Remembers which project the dashboard shows. */
export async function selectProject(projectId: string): Promise<void> {
  (await cookies()).set(PROJECT_COOKIE, projectId, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  });
}
