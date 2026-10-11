'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  chartSeries,
  formatPercent,
  formatTokens,
  formatUsd,
  headlineSavings,
  REASON_LABELS
} from '@/lib/parsim/format';
import type { SavingsSummary } from '@/lib/parsim/types';
import { useSuspenseQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useQueryState } from 'nuqs';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import { rangeParser } from '../api/params';
import { dailyQueryOptions, RANGE_OPTIONS, summaryQueryOptions } from '../api/queries';

const savingsChart = {
  tokensSaved: { label: 'Tokens saved', color: 'var(--primary)' }
} satisfies ChartConfig;

const decisionsChart = {
  count: { label: 'Decisions' }
} satisfies ChartConfig;

/** Decision reasons in the GC's colors: drops in --gc-drop, archives in --gc-archive. */
const REASON_COLORS = {
  duplicate: 'var(--gc-drop)',
  superseded: 'var(--gc-drop)',
  stale_large: 'var(--gc-archive)'
} as const;

export function OverviewView({ projectId }: { projectId: string }) {
  const [days, setDays] = useQueryState('days', rangeParser.withOptions({ shallow: true }));
  const { data: summary } = useSuspenseQuery(summaryQueryOptions(projectId, days));
  const { data: daily } = useSuspenseQuery(dailyQueryOptions(projectId, days));

  const savings = headlineSavings(summary);
  const series = chartSeries(daily);
  const reasons = (Object.keys(REASON_LABELS) as (keyof typeof REASON_LABELS)[]).map((reason) => ({
    reason,
    label: REASON_LABELS[reason],
    count: summary.decisionsByReason[reason],
    fill: REASON_COLORS[reason]
  }));

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <ModeNotice summary={summary} />
        <ToggleGroup
          value={[String(days)]}
          onValueChange={(value) => value[0] && void setDays(Number(value[0]))}
          variant='outline'
          size='sm'
          aria-label='Date range'
        >
          {RANGE_OPTIONS.map((option) => (
            <ToggleGroupItem key={option} value={String(option)}>
              {option} days
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
        <Kpi
          title={savings.estimated ? 'Tokens saved (estimated)' : 'Tokens saved'}
          value={formatTokens(savings.tokensSaved)}
          footer={`of ${formatTokens(summary.gc.tokensBefore)} context tokens`}
        />
        <Kpi
          title={savings.estimated ? 'Dollars saved (estimated)' : 'Dollars saved'}
          value={formatUsd(savings.dollarsSaved)}
          footer={`spent ${formatUsd(summary.costUsd)} in total`}
        />
        <Kpi
          title='Context reduction'
          value={formatPercent(summary.gc.reduction)}
          footer={`${summary.gc.runs} GC runs`}
        />
        <Kpi
          title='Requests'
          value={summary.requests.toLocaleString('en-US')}
          footer={`${summary.upstreamCalls.toLocaleString('en-US')} upstream calls`}
        />
        <Kpi
          title='Recalls'
          value={summary.recalls.count.toLocaleString('en-US')}
          footer={`${formatTokens(summary.recalls.tokensRestored)} tokens restored`}
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-7'>
        <Card className='lg:col-span-4'>
          <CardHeader>
            <CardTitle>
              Savings over time
              {savings.estimated && (
                <Badge variant='outline' className='ml-2'>
                  Estimated
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Tokens the GC removed per day, last {days} days (UTC)</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={savingsChart} className='aspect-auto h-64 w-full'>
              <AreaChart data={series} margin={{ left: 4, right: 12 }}>
                <defs>
                  <linearGradient id='fill-saved' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='5%' stopColor='var(--color-tokensSaved)' stopOpacity={0.5} />
                    <stop offset='95%' stopColor='var(--color-tokensSaved)' stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey='label'
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(value: number) => formatTokens(value)}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator='dot'
                      formatter={(value) => `${formatTokens(Number(value))} tokens`}
                    />
                  }
                />
                <Area
                  dataKey='tokensSaved'
                  type='monotone'
                  fill='url(#fill-saved)'
                  stroke='var(--color-tokensSaved)'
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className='lg:col-span-3'>
          <CardHeader>
            <CardTitle>Decisions by type</CardTitle>
            <CardDescription>
              <span className='inline-flex items-center gap-1'>
                <span className='bg-gc-drop inline-block size-2 rounded-full' /> dropped
              </span>{' '}
              <span className='ml-2 inline-flex items-center gap-1'>
                <span className='bg-gc-archive inline-block size-2 rounded-full' /> archived
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={decisionsChart} className='aspect-auto h-64 w-full'>
              <BarChart data={reasons} layout='vertical' margin={{ left: 12, right: 12 }}>
                <XAxis type='number' hide allowDecimals={false} />
                <YAxis
                  dataKey='label'
                  type='category'
                  tickLine={false}
                  axisLine={false}
                  width={130}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey='count' radius={4}>
                  {reasons.map((entry) => (
                    <Cell key={entry.reason} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ title, value, footer }: { title: string; value: string; footer: string }) {
  return (
    <Card className='gap-2'>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className='text-2xl font-semibold tabular-nums'>{value}</CardTitle>
      </CardHeader>
      <CardFooter className='text-muted-foreground text-xs'>{footer}</CardFooter>
    </Card>
  );
}

function ModeNotice({ summary }: { summary: SavingsSummary }) {
  if (summary.mode === 'shadow') {
    return (
      <Alert className='max-w-3xl'>
        <Icons.info />
        <AlertTitle>Shadow mode: estimated savings</AlertTitle>
        <AlertDescription>
          Parsim forwards your original requests and records what the GC would have saved. Switch
          the GC to On in <Link href='/dashboard/settings'>Settings</Link> to save these tokens.
        </AlertDescription>
      </Alert>
    );
  }
  if (summary.mode === 'off') {
    return (
      <Alert className='max-w-3xl'>
        <Icons.info />
        <AlertTitle>The GC is off for this project</AlertTitle>
        <AlertDescription>
          Requests are forwarded and recorded, but nothing is evaluated. Turn on shadow mode in{' '}
          <Link href='/dashboard/settings'>Settings</Link> to see what Parsim would save.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <p className='text-muted-foreground text-sm'>
      The GC is on: savings are real tokens removed from forwarded requests.
    </p>
  );
}
