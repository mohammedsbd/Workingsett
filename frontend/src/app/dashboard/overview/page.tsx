import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { dailyPath, summaryPath } from '@/features/overview/api/service';
import { overviewKeys } from '@/features/overview/api/queries';
import { rangeParser } from '@/features/overview/api/params';
import { OverviewView } from '@/features/overview/components/overview-view';
import { getQueryClient } from '@/lib/query-client';
import { currentProject, serverGet } from '@/lib/parsim/server-api';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { createSearchParamsCache } from 'nuqs/server';
import type { SearchParams } from 'nuqs/server';
import { Suspense } from 'react';

export const metadata = { title: 'Overview' };

const cache = createSearchParamsCache({ days: rangeParser });

export default async function OverviewPage(props: { searchParams: Promise<SearchParams> }) {
  const { days } = cache.parse(await props.searchParams);
  const { project } = await currentProject();
  if (!project) return null;

  const queryClient = getQueryClient();
  // Awaited: the browser API route is not reachable from server rendering,
  // so the data must be in the cache before the client components render.
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: overviewKeys.summary(project.id, days),
      queryFn: () => serverGet(summaryPath(project.id, days))
    }),
    queryClient.prefetchQuery({
      queryKey: overviewKeys.daily(project.id, days),
      queryFn: () => serverGet(dailyPath(project.id, days))
    })
  ]);

  return (
    <PageContainer
      pageTitle='Overview'
      pageDescription={`What the context GC saved for ${project.name}.`}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<Skeleton className='h-96 w-full' />}>
          <OverviewView projectId={project.id} />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
