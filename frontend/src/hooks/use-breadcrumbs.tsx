'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

/** Readable titles for route segments; anything else is title-cased. */
const SEGMENT_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  overview: 'Overview',
  sessions: 'Agent sessions',
  'api-keys': 'API keys',
  settings: 'Settings',
  setup: 'Setup'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function segmentTitle(segment: string): string {
  if (SEGMENT_TITLES[segment]) return SEGMENT_TITLES[segment];
  // Ids (an agent session) are shortened; the page title has the full name.
  if (UUID.test(segment)) return segment.slice(0, 8);
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function useBreadcrumbs() {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      return {
        title: segmentTitle(segment),
        link: path
      };
    });
  }, [pathname]);

  return breadcrumbs;
}
