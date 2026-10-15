'use client';

import { Icons } from '@/components/icons';
import { LocalTime } from '@/components/time';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  formatAgreement,
  formatTokens,
  formatUsd,
  isReplayActive,
  pointVerdict,
  reduction,
  formatPercent,
  REPLAY_STATUS_LABELS,
  replayProgress,
  toggleRequest
} from '@/lib/parsim/format';
import type {
  ReplayAnswer,
  ReplayOptions,
  ReplayPoint,
  ReplayStatus,
  ReplaySummary,
  ReplayVariant
} from '@/lib/parsim/types';
import { cn } from '@/lib/utils';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  replayEstimateQueryOptions,
  replayOptionsQueryOptions,
  replayReportQueryOptions,
  replaysQueryOptions,
  startReplayMutation
} from '../api/queries';

/**
 * The session's Replay tab: start a replay (with its cost estimate), follow
 * its progress, and read the report.
 */
export function SessionReplay({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const options = useQuery(replayOptionsQueryOptions(projectId, sessionId));
  const replays = useQuery(replaysQueryOptions(projectId, sessionId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = selectedId ?? replays.data?.[0]?.id ?? null;

  if (options.isPending) {
    return <p className='text-muted-foreground p-6 text-sm'>Loading replay options...</p>;
  }
  if (options.isError) {
    return <p className='text-destructive p-6 text-sm'>{options.error.message}</p>;
  }

  return (
    <div className='flex flex-col gap-4'>
      <StartReplay
        projectId={projectId}
        sessionId={sessionId}
        options={options.data}
        onStarted={setSelectedId}
      />
      {replays.data && replays.data.length > 0 && (
        <ReplayList replays={replays.data} selectedId={current} onSelect={setSelectedId} />
      )}
      {current && (
        <ReplayReportView projectId={projectId} sessionId={sessionId} replayId={current} />
      )}
    </div>
  );
}

function StartReplay({
  projectId,
  sessionId,
  options,
  onStarted
}: {
  projectId: string;
  sessionId: string;
  options: ReplayOptions;
  onStarted: (id: string) => void;
}) {
  const [selected, setSelected] = useState(options.defaultRequestNumbers);
  const [budgetText, setBudgetText] = useState(String(options.defaultBudgetUsd));
  const [budget, setBudget] = useState(options.defaultBudgetUsd);
  const request = { requestNumbers: selected, budgetUsd: budget };
  const estimate = useQuery({
    ...replayEstimateQueryOptions(projectId, sessionId, request),
    enabled: !options.blockedReason && selected.length > 0
  });
  const start = useMutation({
    ...startReplayMutation(projectId, sessionId),
    onSuccess: (replay) => {
      toast.success('Replay started');
      onStarted(replay.id);
    },
    onError: (error) => toast.error(`Could not start: ${error.message}`)
  });

  if (options.blockedReason) {
    return (
      <Alert>
        <Icons.info />
        <AlertTitle>This session cannot be replayed</AlertTitle>
        <AlertDescription>{options.blockedReason}</AlertDescription>
      </Alert>
    );
  }

  const applyBudget = () => {
    const value = Number(budgetText);
    if (value > 0 && value <= options.maxBudgetUsd) setBudget(value);
    else setBudgetText(String(budget));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Replay this session</CardTitle>
        <CardDescription>
          Each chosen request is sent again twice with the project&apos;s provider key, as recorded
          and as the GC made it (same model, temperature 0), and the answers are compared. A{' '}
          {options.judge.model} judge ({options.judge.keySource === 'parsim' ? "Parsim's" : 'your'}{' '}
          key) scores answers that differ.
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <Label>
            Request points ({selected.length} of at most {options.maxPoints})
          </Label>
          <div className='flex flex-wrap gap-1'>
            {options.candidates.map((c) => (
              <Button
                key={c.requestNumber}
                type='button'
                size='xs'
                variant={selected.includes(c.requestNumber) ? 'default' : 'outline'}
                onClick={() =>
                  setSelected((s) => toggleRequest(s, c.requestNumber, options.maxPoints))
                }
                aria-pressed={selected.includes(c.requestNumber)}
                aria-label={`Request ${c.requestNumber}${c.gcChanged ? ', changed by the GC' : ''}`}
                title={
                  c.gcChanged ? 'The GC changed this request' : 'The GC left this request as is'
                }
              >
                #{c.requestNumber}
                {c.gcChanged && <span className='bg-gc-archive size-1.5 rounded-full' />}
              </Button>
            ))}
          </div>
          <p className='text-muted-foreground text-xs'>
            A dot marks requests the GC changed; the others replay the same context twice.
          </p>
        </div>

        <div className='flex max-w-xs flex-col gap-2'>
          <Label htmlFor='replay-budget'>Budget (USD, hard limit)</Label>
          <Input
            id='replay-budget'
            type='number'
            min={0.01}
            max={options.maxBudgetUsd}
            step={0.01}
            value={budgetText}
            onChange={(e) => setBudgetText(e.target.value)}
            onBlur={applyBudget}
            onKeyDown={(e) => e.key === 'Enter' && applyBudget()}
          />
          <p className='text-muted-foreground text-xs'>
            No call starts if it could take the replay above this. At most{' '}
            {formatUsd(options.maxBudgetUsd)}.
          </p>
        </div>

        {selected.length > 0 && (
          <div className='rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead className='text-right'>Context as recorded</TableHead>
                  <TableHead className='text-right'>After GC</TableHead>
                  <TableHead className='text-right'>Estimated cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {estimate.isPending && (
                  <TableRow>
                    <TableCell colSpan={4} className='text-muted-foreground text-center'>
                      Estimating...
                    </TableCell>
                  </TableRow>
                )}
                {estimate.isError && (
                  <TableRow>
                    <TableCell colSpan={4} className='text-destructive text-center'>
                      {estimate.error.message}
                    </TableCell>
                  </TableRow>
                )}
                {estimate.data?.points.map((p) => (
                  <TableRow key={p.requestNumber}>
                    <TableCell>
                      #{p.requestNumber}{' '}
                      <span className='text-muted-foreground text-xs'>{p.model}</span>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatTokens(p.originalInputTokens)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatTokens(p.gcInputTokens)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatUsd(p.originalUsd + p.gcUsd + p.judgeUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {estimate.data && (
          <div className='flex flex-wrap items-center gap-3'>
            <span className='text-sm'>
              Estimated cost{' '}
              <span className='font-semibold tabular-nums'>
                {formatUsd(estimate.data.totalUsd)}
              </span>{' '}
              of a {formatUsd(estimate.data.budgetUsd)} budget
            </span>
            {estimate.data.overBudget && (
              <Badge variant='destructive'>Above the budget: the replay will stop early</Badge>
            )}
          </div>
        )}

        <div>
          <Button
            type='button'
            disabled={!estimate.data || start.isPending}
            onClick={() => start.mutate(request)}
          >
            {start.isPending ? <Icons.spinner className='animate-spin' /> : null}
            Start replay
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ReplayStatus }) {
  return (
    <Badge
      variant={
        status === 'failed' ? 'destructive' : status === 'completed' ? 'secondary' : 'outline'
      }
    >
      {isReplayActive(status) && <Icons.spinner className='animate-spin' />}
      {REPLAY_STATUS_LABELS[status]}
    </Badge>
  );
}

function ReplayList({
  replays,
  selectedId,
  onSelect
}: {
  replays: ReplaySummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className='rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className='min-w-40'>Progress</TableHead>
            <TableHead className='text-right'>Spent</TableHead>
            <TableHead>Judge</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {replays.map((r) => (
            <TableRow
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={cn('cursor-pointer', r.id === selectedId && 'bg-muted/50')}
            >
              <TableCell className='whitespace-nowrap'>
                <LocalTime date={r.createdAt} />
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell>
                <div className='flex items-center gap-2'>
                  <Progress value={replayProgress(r)} className='w-24' />
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {r.pointsDone}/{r.pointsTotal}
                  </span>
                </div>
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatUsd(r.spentUsd)}
                <span className='text-muted-foreground block text-xs'>
                  of {formatUsd(r.budgetUsd)}
                </span>
              </TableCell>
              <TableCell className='text-muted-foreground text-xs'>{r.judgeModel}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReplayReportView({
  projectId,
  sessionId,
  replayId
}: {
  projectId: string;
  sessionId: string;
  replayId: string;
}) {
  const report = useQuery(replayReportQueryOptions(projectId, sessionId, replayId));
  if (report.isPending) {
    return <p className='text-muted-foreground p-6 text-sm'>Loading the report...</p>;
  }
  if (report.isError) {
    return <p className='text-destructive p-6 text-sm'>{report.error.message}</p>;
  }
  const { replay, agreement, totals, points, contentAllowed } = report.data;
  const active = isReplayActive(replay.status);

  return (
    <div className='flex flex-col gap-4'>
      {active && (
        <Card className='gap-2 py-4'>
          <div className='flex items-center gap-3 px-4'>
            <StatusBadge status={replay.status} />
            <Progress value={replayProgress(replay)} className='flex-1' />
            <span className='text-muted-foreground text-sm tabular-nums'>
              {replay.pointsDone} of {replay.pointsTotal} points
            </span>
          </div>
        </Card>
      )}
      {replay.error && (
        <Alert variant={replay.status === 'failed' ? 'destructive' : 'default'}>
          <Icons.warning />
          <AlertTitle>{REPLAY_STATUS_LABELS[replay.status]}</AlertTitle>
          <AlertDescription>
            {replay.error}. {replay.pointsDone} of {replay.pointsTotal} points were replayed.
          </AlertDescription>
        </Alert>
      )}

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <ReportStat
          label='Agreement'
          value={formatAgreement(agreement)}
          hint={`${agreement.agreed} of ${agreement.judged} points, ${agreement.exactMatches} identical${agreement.failed ? `, ${agreement.failed} failed` : ''}`}
        />
        <ReportStat
          label='As recorded'
          value={formatUsd(totals.original.costUsd)}
          hint={`${formatTokens(totals.original.inputTokens)} in, ${formatTokens(totals.original.outputTokens)} out`}
        />
        <ReportStat
          label='After GC'
          value={formatUsd(totals.gc.costUsd)}
          hint={`${formatTokens(totals.gc.inputTokens)} in (${formatPercent(reduction(totals.original.inputTokens, totals.gc.inputTokens))} fewer), ${formatTokens(totals.gc.outputTokens)} out`}
        />
        <ReportStat
          label='Replay cost'
          value={formatUsd(replay.spentUsd)}
          hint={`of ${formatUsd(replay.budgetUsd)} budget, judge ${formatUsd(totals.judgeCostUsd)}, estimated ${formatUsd(replay.estimatedCostUsd)}`}
        />
      </div>

      {!contentAllowed && (
        <p className='text-muted-foreground text-sm'>
          This project does not store content any more, so the answers and judge reasons are hidden.
        </p>
      )}
      <div className='flex flex-col gap-2'>
        {points.length === 0 && (
          <p className='text-muted-foreground rounded-lg border p-6 text-center text-sm'>
            {active ? 'No point is finished yet.' : 'No point was replayed.'}
          </p>
        )}
        {points.map((point) => (
          <PointRow key={point.requestNumber} point={point} contentAllowed={contentAllowed} />
        ))}
      </div>
    </div>
  );
}

function ReportStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className='gap-1'>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className='text-2xl font-semibold tabular-nums'>{value}</CardTitle>
        <CardDescription className='text-xs'>{hint}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Agreeing points stay quiet; differences use the drop color to stand out. */
const TONE_BADGES = {
  agree: { variant: 'secondary', className: '', icon: Icons.check },
  differ: { variant: 'default', className: 'bg-gc-drop text-white', icon: Icons.warning },
  unknown: { variant: 'outline', className: '', icon: null },
  failed: { variant: 'destructive', className: '', icon: Icons.warning }
} as const;

function PointRow({ point, contentAllowed }: { point: ReplayPoint; contentAllowed: boolean }) {
  const verdict = pointVerdict(point);
  const tone = TONE_BADGES[verdict.tone];
  return (
    <Collapsible className='rounded-lg border'>
      <CollapsibleTrigger className='flex w-full flex-wrap items-center gap-3 p-3 text-left text-sm'>
        <Icons.chevronRight className='size-4' />
        <span className='font-medium'>Request #{point.requestNumber}</span>
        <Badge variant={tone.variant} className={tone.className}>
          {tone.icon && <tone.icon />}
          {verdict.label}
        </Badge>
        {point.status === 'completed' && (
          <Badge variant='outline'>
            {point.toolCallsMatch ? 'Same tool calls' : 'Different tool calls'}
          </Badge>
        )}
        {!point.gcChanged && <Badge variant='secondary'>GC left it unchanged</Badge>}
        {point.original && point.gc && (
          <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
            {formatTokens(point.original.inputTokens)} to {formatTokens(point.gc.inputTokens)} input
            tokens, {formatUsd(point.original.costUsd)} to {formatUsd(point.gc.costUsd)}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className='flex flex-col gap-3 border-t p-3 text-sm'>
        {point.error && <p className='text-destructive'>Error: {point.error}</p>}
        {contentAllowed && point.judgeReason && (
          <p>
            <span className='text-muted-foreground'>Judge: </span>
            {point.judgeReason}
          </p>
        )}
        <div className='grid gap-3 md:grid-cols-2'>
          <VariantColumn title='As recorded' variant={point.original} />
          <VariantColumn title='After GC' variant={point.gc} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function VariantColumn({ title, variant }: { title: string; variant: ReplayVariant | null }) {
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <div className='flex flex-wrap items-baseline gap-2'>
        <span className='font-medium'>{title}</span>
        {variant && (
          <span className='text-muted-foreground text-xs tabular-nums'>
            {formatTokens(variant.inputTokens)} in, {formatTokens(variant.outputTokens)} out,{' '}
            {formatUsd(variant.costUsd)}
            {variant.recalls > 0 && `, ${variant.recalls} recalls`}
            {!variant.temperatureZero && ', default temperature'}
          </span>
        )}
      </div>
      {!variant ? (
        <p className='text-muted-foreground'>Not replayed.</p>
      ) : variant.error ? (
        <p className='text-destructive'>{variant.error}</p>
      ) : variant.answer === undefined ? (
        <p className='text-muted-foreground'>Hidden (content storage is off).</p>
      ) : (
        <AnswerBlock answer={variant.answer} />
      )}
    </div>
  );
}

function AnswerBlock({ answer }: { answer: ReplayAnswer | null }) {
  if (!answer) return <p className='text-muted-foreground'>No answer.</p>;
  return (
    <pre className='bg-muted max-h-96 overflow-auto rounded p-3 text-xs whitespace-pre-wrap'>
      {answer.text.trim() || '(no text)'}
      {answer.toolCalls
        .map((call) => `\n\n${call.name}(${JSON.stringify(call.arguments, null, 2)})`)
        .join('')}
    </pre>
  );
}
