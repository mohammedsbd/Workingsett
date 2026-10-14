'use client';

import { Icons } from '@/components/icons';
import { LocalTime } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  formatPercent,
  formatTokens,
  formatUsd,
  reduction,
  REASON_LABELS
} from '@/lib/parsim/format';
import type {
  ContentPart,
  TimelineCompression,
  TimelineDecision,
  TimelineRequest
} from '@/lib/parsim/types';
import { useSuspenseQuery } from '@tanstack/react-query';
import { sessionQueryOptions } from '../api/queries';

export function SessionDetailView({
  projectId,
  sessionId
}: {
  projectId: string;
  sessionId: string;
}) {
  const { data } = useSuspenseQuery(sessionQueryOptions(projectId, sessionId));
  const before = data.requests.reduce((sum, r) => sum + (r.gc?.tokensBefore ?? 0), 0);
  const after = data.requests.reduce((sum, r) => sum + (r.gc?.tokensAfter ?? 0), 0);
  const shadow = data.requests.some((r) => r.gc?.mode === 'shadow');

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <Stat label='Requests' value={data.requests.length.toLocaleString('en-US')} />
        <Stat
          label={shadow ? 'Tokens saved (estimated)' : 'Tokens saved'}
          value={formatTokens(before - after)}
          hint={`${formatPercent(reduction(before, after))} of ${formatTokens(before)}`}
        />
        <Stat label='GC decisions' value={data.decisions.length.toLocaleString('en-US')} />
        <Stat
          label='Recalls'
          value={data.recalls.length.toLocaleString('en-US')}
          hint={`${formatTokens(data.recalls.reduce((s, r) => s + r.tokensRestored, 0))} tokens restored`}
        />
      </div>

      <Tabs defaultValue='requests'>
        <TabsList>
          <TabsTrigger value='requests'>Requests</TabsTrigger>
          <TabsTrigger value='decisions'>Decisions</TabsTrigger>
          <TabsTrigger value='recalls'>Recalls</TabsTrigger>
          <TabsTrigger value='compressions'>Compressions</TabsTrigger>
        </TabsList>
        <TabsContent value='compressions'>
          <CompressionsList compressions={data.compressions} contentAllowed={data.contentAllowed} />
        </TabsContent>
        <TabsContent value='requests'>
          <RequestsTable requests={data.requests} />
        </TabsContent>
        <TabsContent value='decisions'>
          <DecisionsList decisions={data.decisions} contentAllowed={data.contentAllowed} />
        </TabsContent>
        <TabsContent value='recalls'>
          <div className='rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Archive id</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className='text-right'>Tokens restored</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recalls.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className='text-muted-foreground text-center'>
                      The model never recalled archived content in this session.
                    </TableCell>
                  </TableRow>
                )}
                {data.recalls.map((recall, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <LocalTime date={recall.createdAt} />
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {recall.archiveId || '(none)'}
                    </TableCell>
                    <TableCell>
                      {recall.refused ? 'Over the limit' : recall.found ? 'Found' : 'Not found'}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatTokens(recall.tokensRestored)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className='gap-1'>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className='text-2xl font-semibold tabular-nums'>{value}</CardTitle>
        {hint && <CardDescription className='text-xs'>{hint}</CardDescription>}
      </CardHeader>
    </Card>
  );
}

function RequestsTable({ requests }: { requests: TimelineRequest[] }) {
  return (
    <div className='rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Context before / after GC</TableHead>
            <TableHead>GC</TableHead>
            <TableHead className='text-right'>Input</TableHead>
            <TableHead className='text-right'>Cached</TableHead>
            <TableHead className='text-right'>Output</TableHead>
            <TableHead className='text-right'>Cost</TableHead>
            <TableHead className='text-right'>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request, index) => (
            <TableRow key={request.id}>
              <TableCell className='text-muted-foreground tabular-nums'>{index + 1}</TableCell>
              <TableCell className='whitespace-nowrap'>
                <LocalTime date={request.createdAt} />
              </TableCell>
              <TableCell className='min-w-48'>
                <ContextBar gc={request.gc} />
              </TableCell>
              <TableCell>
                <GcBadge gc={request.gc} />
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatTokens(request.inputTokens)}
                {request.upstreamCalls > 1 && (
                  <span className='text-muted-foreground block text-xs'>
                    {request.upstreamCalls} calls
                  </span>
                )}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {request.cachedInputTokens === null ? '-' : formatTokens(request.cachedInputTokens)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatTokens(request.outputTokens)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {request.costUsd === null ? '-' : formatUsd(request.costUsd)}
              </TableCell>
              <TableCell className='text-right'>
                <Badge variant={request.status < 400 ? 'outline' : 'destructive'}>
                  {request.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ContextBar({ gc }: { gc: TimelineRequest['gc'] }) {
  if (!gc || gc.tokensBefore === null || gc.tokensAfter === null) {
    return <span className='text-muted-foreground text-xs'>not evaluated</span>;
  }
  const kept = gc.tokensBefore ? (gc.tokensAfter / gc.tokensBefore) * 100 : 100;
  return (
    <div className='flex flex-col gap-1'>
      <div className='bg-gc-drop/25 h-2 w-full overflow-hidden rounded-full'>
        <div className='bg-primary h-full rounded-full' style={{ width: `${kept}%` }} />
      </div>
      <span className='text-muted-foreground text-xs tabular-nums'>
        {formatTokens(gc.tokensBefore)} to {formatTokens(gc.tokensAfter)}
      </span>
    </div>
  );
}

function GcBadge({ gc }: { gc: TimelineRequest['gc'] }) {
  if (!gc) return <span className='text-muted-foreground text-xs'>off</span>;
  if (gc.failed) return <Badge variant='destructive'>failed, sent original</Badge>;
  return (
    <div className='flex flex-wrap gap-1'>
      <Badge variant='outline'>
        {gc.mode === 'shadow' ? 'shadow' : gc.applied ? 'applied' : 'unchanged'}
      </Badge>
      {gc.ran && <Badge variant='secondary'>pass, {gc.newDecisionCount} new</Badge>}
    </div>
  );
}

function DecisionsList({
  decisions,
  contentAllowed
}: {
  decisions: TimelineDecision[];
  contentAllowed: boolean;
}) {
  if (decisions.length === 0) {
    return (
      <p className='text-muted-foreground rounded-lg border p-6 text-center text-sm'>
        The GC made no decisions in this session yet.
      </p>
    );
  }
  return (
    <div className='flex flex-col gap-2'>
      {!contentAllowed && (
        <p className='text-muted-foreground text-sm'>
          This project does not store content, so original tool results are not shown.
        </p>
      )}
      {decisions.map((decision) => (
        <Card
          key={`${decision.position}-${decision.archiveId ?? decision.reason}`}
          className='gap-2 py-4'
        >
          <div className='flex flex-wrap items-center gap-2 px-4'>
            <Badge
              className={
                decision.decision === 'archive'
                  ? 'bg-gc-archive text-white'
                  : 'bg-gc-drop text-white'
              }
            >
              {decision.decision === 'archive' ? 'Archived' : 'Dropped'}
            </Badge>
            <span className='font-medium'>{decision.toolName}</span>
            <span className='text-muted-foreground text-sm'>{REASON_LABELS[decision.reason]}</span>
            <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
              item {decision.position}, {formatTokens(decision.tokensBefore)} to{' '}
              {formatTokens(decision.tokensAfter)} tokens
            </span>
          </div>
          <div className='flex flex-col gap-2 px-4'>
            <p className='text-muted-foreground text-sm'>Why: {decision.detail}</p>
            <code className='bg-muted block rounded px-2 py-1 text-xs break-all'>
              {decision.replacement}
            </code>
            {contentAllowed && decision.content && (
              <Collapsible>
                <CollapsibleTrigger className='text-primary flex items-center gap-1 text-sm'>
                  <Icons.chevronRight className='size-4' /> Original tool result
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className='bg-muted mt-2 max-h-80 overflow-auto rounded p-3 text-xs whitespace-pre-wrap'>
                    {contentText(decision.content.parts)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Readable text of stored content (text as is, other values as JSON). */
export function contentText(parts: ContentPart[]): string {
  return parts
    .map((part) => {
      switch (part.type) {
        case 'text':
        case 'thinking':
          return part.text;
        case 'tool_result':
          return contentText(part.content);
        case 'tool_call':
          return `${part.name}(${JSON.stringify(part.input)})`;
        case 'image':
          return '[image]';
        case 'other':
          return JSON.stringify(part.value, null, 2);
      }
    })
    .join('\n');
}

const COMPRESSION_STATUS = {
  pending: 'Summarizing',
  ready: 'In use',
  failed: 'Failed'
} as const;

/** Finished stretches summarized into state blocks. */
function CompressionsList({
  compressions,
  contentAllowed
}: {
  compressions: TimelineCompression[];
  contentAllowed: boolean;
}) {
  if (compressions.length === 0) {
    return (
      <p className='text-muted-foreground rounded-lg border p-6 text-center text-sm'>
        No stretch of this session was compressed. Compression runs in On mode for projects that
        turn it on.
      </p>
    );
  }
  return (
    <div className='flex flex-col gap-2'>
      {compressions.map((c) => (
        <Collapsible key={c.id} className='rounded-lg border'>
          <CollapsibleTrigger className='flex w-full flex-wrap items-center gap-3 p-3 text-left text-sm'>
            <Badge variant={c.status === 'failed' ? 'destructive' : 'outline'}>
              {COMPRESSION_STATUS[c.status]}
            </Badge>
            <span className='font-medium'>
              Turns {c.firstTurn} to {c.lastTurn}
            </span>
            <span className='text-muted-foreground tabular-nums'>
              {formatTokens(c.tokensBefore)}
              {c.tokensAfter !== null && ` to ${formatTokens(c.tokensAfter)}`} tokens
            </span>
            {c.costUsd !== null && (
              <span className='text-muted-foreground tabular-nums'>
                summary cost {formatUsd(c.costUsd)}
              </span>
            )}
            <span className='text-muted-foreground ml-auto text-xs'>
              <LocalTime date={c.createdAt} />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className='border-t p-3 text-sm'>
            {c.error && <p className='text-destructive mb-2'>Error: {c.error}</p>}
            {!contentAllowed ? (
              <p className='text-muted-foreground'>
                The state block is hidden because this project does not store content.
              </p>
            ) : c.stateBlock ? (
              <pre className='bg-muted max-h-96 overflow-auto rounded p-3 text-xs whitespace-pre-wrap'>
                {c.stateBlock}
              </pre>
            ) : (
              <p className='text-muted-foreground'>No state block yet.</p>
            )}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
