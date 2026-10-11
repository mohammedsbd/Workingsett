'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { RelativeTime } from '@/components/time';
import { formatTokens } from '@/lib/parsim/format';
import type { SessionRow } from '@/lib/parsim/types';
import type { Column, ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';

const header =
  (title: string) =>
  ({ column }: { column: Column<SessionRow, unknown> }) => (
    <DataTableColumnHeader column={column} title={title} />
  );

export const columns: ColumnDef<SessionRow>[] = [
  {
    id: 'externalId',
    accessorKey: 'externalId',
    header: header('Session'),
    cell: ({ row }) => (
      <div className='flex flex-col'>
        <Link
          href={`/dashboard/sessions/${row.original.id}`}
          className='font-medium underline-offset-4 hover:underline'
        >
          {row.original.externalId}
        </Link>
        <span className='text-muted-foreground text-xs'>
          {row.original.provider}, {row.original.model}
        </span>
      </div>
    ),
    meta: {
      label: 'Session',
      placeholder: 'Search sessions or models...',
      variant: 'text' as const,
      icon: Icons.search
    },
    enableColumnFilter: true,
    enableSorting: false
  },
  {
    id: 'requestCount',
    accessorKey: 'requestCount',
    header: header('Requests'),
    cell: ({ row }) => <span className='tabular-nums'>{row.original.requestCount}</span>
  },
  {
    id: 'tokensSaved',
    accessorKey: 'tokensSaved',
    header: header('Tokens saved'),
    cell: ({ row }) => (
      <span className='tabular-nums'>{formatTokens(row.original.tokensSaved)}</span>
    )
  },
  {
    id: 'decisions',
    accessorKey: 'decisions',
    header: 'Decisions',
    enableSorting: false,
    cell: ({ row }) => <span className='tabular-nums'>{row.original.decisions}</span>
  },
  {
    id: 'recalls',
    accessorKey: 'recalls',
    header: 'Recalls',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.recalls ? (
        <Badge variant='outline' className='tabular-nums'>
          {row.original.recalls}
        </Badge>
      ) : (
        <span className='text-muted-foreground'>0</span>
      )
  },
  {
    id: 'firstSeenAt',
    accessorKey: 'firstSeenAt',
    header: header('Started'),
    cell: ({ row }) => <RelativeTime date={row.original.firstSeenAt} />
  },
  {
    id: 'lastSeenAt',
    accessorKey: 'lastSeenAt',
    header: header('Last request'),
    cell: ({ row }) => <RelativeTime date={row.original.lastSeenAt} />
  }
];
