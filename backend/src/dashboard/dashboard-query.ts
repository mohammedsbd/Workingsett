import { BadRequestException } from '@nestjs/common';
import { DateRangeQueryDto } from './dto/dashboard-query.dto';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

export type DateRange = { from: Date; to: Date };

/**
 * The requested range, defaulting to the 30 days before `now`. `to` is
 * exclusive. Rejects empty, reversed and over-long ranges.
 *
 * `now` must come from the database clock (see `DashboardService.dbNow`):
 * rows get their `createdAt` from the database's now(), and Node's clock can
 * run a few milliseconds behind it, which would leave the newest rows out.
 */
export function parseRange(query: DateRangeQueryDto, now: Date): DateRange {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  if (from >= to) throw new BadRequestException('from must be before to');
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(
      `The range can be at most ${MAX_RANGE_DAYS} days`,
    );
  }
  return { from, to };
}

/** The UTC days (YYYY-MM-DD) a range touches, in order. */
export function utcDays(range: DateRange): string[] {
  const days: string[] = [];
  const start = Date.UTC(
    range.from.getUTCFullYear(),
    range.from.getUTCMonth(),
    range.from.getUTCDate(),
  );
  for (let t = start; t < range.to.getTime(); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** Escapes LIKE wildcards so a search matches them literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
