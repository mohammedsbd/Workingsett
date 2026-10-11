import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsKeys } from '@/features/settings/api/queries';
import { settingsPath } from '@/features/settings/api/service';
import { SettingsForm } from '@/features/settings/components/settings-form';
import { currentProject, serverGet } from '@/lib/parsim/server-api';
import { getQueryClient } from '@/lib/query-client';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { Suspense } from 'react';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { project } = await currentProject();
  if (!project) return null;

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: settingsKeys.detail(project.id),
    queryFn: () => serverGet(settingsPath(project.id))
  });

  return (
    <PageContainer pageTitle='Settings' pageDescription={`GC settings for ${project.name}.`}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<Skeleton className='h-96 w-full max-w-3xl' />}>
          {/* Keyed so the form resets when another project is selected. */}
          <SettingsForm key={project.id} projectId={project.id} />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
