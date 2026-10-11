import PageContainer from '@/components/layout/page-container';
import { DataTableSkeleton } from '@/components/ui/table/data-table-skeleton';
import { filtersFrom, sessionsParams } from '@/features/sessions/api/params';
import { sessionKeys } from '@/features/sessions/api/queries';
import { sessionsPath } from '@/features/sessions/api/service';
import { SessionsTable } from '@/features/sessions/components/sessions-table';
import { currentProject, serverGet } from '@/lib/parsim/server-api';
import { getQueryClient } from '@/lib/query-client';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { createSearchParamsCache, type SearchParams } from 'nuqs/server';
import { Suspense } from 'react';

export const metadata = { title: 'Agent sessions' };

const cache = createSearchParamsCache(sessionsParams);

export default async function SessionsPage(props: { searchParams: Promise<SearchParams> }) {
  const filters = filtersFrom(cache.parse(await props.searchParams));
  const { project } = await currentProject();
  if (!project) return null;

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: sessionKeys.list(project.id, filters),
    queryFn: () => serverGet(sessionsPath(project.id, filters))
  });

  return (
    <PageContainer
      pageTitle='Agent sessions'
      pageDescription='Each run of an agent, with what the GC removed from its context.'
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<DataTableSkeleton columnCount={7} rowCount={10} filterCount={1} />}>
          <SessionsTable projectId={project.id} />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
