'use client';

import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { useTransition } from 'react';
import { filtersFrom, sessionsParams } from '../../api/params';
import { sessionsQueryOptions } from '../../api/queries';
import { columns } from './columns';

export function SessionsTable({ projectId }: { projectId: string }) {
  // URL changes (search, sort, page) run in a transition, so the current
  // rows stay on screen while the next page loads instead of a skeleton.
  const [, startTransition] = useTransition();
  const [params] = useQueryStates(sessionsParams, { startTransition });
  const filters = filtersFrom(params);
  const { data } = useSuspenseQuery(sessionsQueryOptions(projectId, filters));

  const { table } = useDataTable({
    data: data.data,
    columns,
    pageCount: Math.max(1, Math.ceil(data.total / filters.limit)),
    shallow: true,
    debounceMs: 400,
    startTransition,
    initialState: {
      sorting: [{ id: 'lastSeenAt', desc: true }],
      pagination: { pageIndex: 0, pageSize: 20 }
    }
  });

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
