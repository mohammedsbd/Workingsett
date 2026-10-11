import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { sessionKeys } from '@/features/sessions/api/queries';
import { sessionPath } from '@/features/sessions/api/service';
import { SessionDetailView } from '@/features/sessions/components/session-detail';
import { currentProject, serverGet } from '@/lib/parsim/server-api';
import type { SessionDetail } from '@/lib/parsim/types';
import { getQueryClient } from '@/lib/query-client';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

export const metadata = { title: 'Agent session' };

export default async function SessionPage(props: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await props.params;
  const { project } = await currentProject();
  if (!project) return null;

  const queryClient = getQueryClient();
  let detail: SessionDetail;
  try {
    detail = await queryClient.fetchQuery({
      queryKey: sessionKeys.detail(project.id, sessionId),
      queryFn: () => serverGet<SessionDetail>(sessionPath(project.id, sessionId))
    });
  } catch {
    notFound();
  }

  return (
    <PageContainer
      pageTitle={detail.session.externalId}
      pageDescription={`${detail.session.provider}, ${detail.session.model}, started ${new Date(detail.session.firstSeenAt).toLocaleString()}`}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<Skeleton className='h-96 w-full' />}>
          <SessionDetailView projectId={project.id} sessionId={sessionId} />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
