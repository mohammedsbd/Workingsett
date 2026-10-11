import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { keyKeys } from '@/features/api-keys/api/queries';
import { keysPath } from '@/features/api-keys/api/service';
import { ApiKeysView, CreateKeyButton } from '@/features/api-keys/components/api-keys-view';
import { currentProject, serverGet } from '@/lib/parsim/server-api';
import { getQueryClient } from '@/lib/query-client';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { Suspense } from 'react';

export const metadata = { title: 'API keys' };

export default async function ApiKeysPage() {
  const { project } = await currentProject();
  if (!project) return null;

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: keyKeys.list(project.id),
    queryFn: () => serverGet(keysPath(project.id))
  });

  return (
    <PageContainer
      pageTitle='API keys'
      pageDescription={`Parsim keys for ${project.name}. Only a short prefix is stored in readable form.`}
      pageHeaderAction={<CreateKeyButton projectId={project.id} />}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<Skeleton className='h-48 w-full' />}>
          <ApiKeysView projectId={project.id} />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
