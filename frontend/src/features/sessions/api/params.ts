import { getSortingStateParser } from '@/lib/parsers';
import { parseAsInteger, parseAsString } from 'nuqs/server';
import type { SessionRow } from '@/lib/parsim/types';
import { SORTABLE, type SessionFilters, type SessionSort } from './service';

/** URL state of the sessions table (shared by the server page and the client table). */
export const sessionsParams = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(20),
  externalId: parseAsString,
  sort: getSortingStateParser<SessionRow>([...SORTABLE]).withDefault([
    { id: 'lastSeenAt', desc: true }
  ])
};

export function filtersFrom(params: {
  page: number;
  perPage: number;
  externalId: string | null;
  sort: { id: string; desc: boolean }[];
}): SessionFilters {
  const [first] = params.sort;
  return {
    page: params.page,
    limit: Math.min(params.perPage, 100),
    search: params.externalId,
    sort: (first?.id as SessionSort | undefined) ?? 'lastSeenAt',
    order: first && !first.desc ? 'asc' : 'desc'
  };
}
