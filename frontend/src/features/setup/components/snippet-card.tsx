import { CopyButton } from '@/components/copy-button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import type { Snippet } from '../snippets';

export function SnippetCard({ snippet, current }: { snippet: Snippet; current: boolean }) {
  return (
    <Card className={current ? 'border-primary/60' : undefined}>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {snippet.title}
          {current && <Badge>This project</Badge>}
        </CardTitle>
        <CardDescription>
          {snippet.description}
          {!current && ` Needs a project with the ${snippet.upstream} upstream.`}
        </CardDescription>
        <CardAction>
          <CopyButton text={snippet.code} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <pre className='bg-muted overflow-x-auto rounded-md p-3 text-xs'>
          <code>{snippet.code}</code>
        </pre>
      </CardContent>
    </Card>
  );
}
