import PageContainer from '@/components/layout/page-container';
import { SnippetCard } from '@/features/setup/components/snippet-card';
import { SESSION_HEADER_SNIPPET, setupSnippets } from '@/features/setup/snippets';
import { proxyUrl } from '@/lib/parsim/config';
import { currentProject } from '@/lib/parsim/server-api';
import Link from 'next/link';

export const metadata = { title: 'Setup' };

export default async function SetupPage() {
  const { project } = await currentProject();
  if (!project) return null;
  const url = proxyUrl();
  const snippets = setupSnippets(url).toSorted(
    (a, b) => Number(b.upstream === project.upstream) - Number(a.upstream === project.upstream)
  );

  return (
    <PageContainer
      pageTitle='Setup'
      pageDescription={`Send the traffic of ${project.name} through Parsim at ${url}.`}
    >
      <div className='flex max-w-4xl flex-col gap-4'>
        <p className='text-muted-foreground text-sm'>
          Replace your provider&apos;s base URL with Parsim&apos;s and use a Parsim key from{' '}
          <Link href='/dashboard/api-keys' className='underline'>
            API keys
          </Link>{' '}
          as the API key. This project forwards to <strong>{project.upstream}</strong>
          {project.hasProviderKey
            ? ' with the provider key stored on it.'
            : '; it has no stored provider key, so send yours per request in the x-provider-key header.'}{' '}
          To group an agent run into one session, also send{' '}
          <code className='bg-muted rounded px-1'>{SESSION_HEADER_SNIPPET}</code>.
        </p>
        {snippets.map((snippet) => (
          <SnippetCard
            key={snippet.id}
            snippet={snippet}
            current={snippet.upstream === project.upstream}
          />
        ))}
      </div>
    </PageContainer>
  );
}
