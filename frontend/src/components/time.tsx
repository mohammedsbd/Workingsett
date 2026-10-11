'use client';

import { timeAgo } from '@/lib/parsim/format';

/**
 * Times rendered on the server and again in the browser can differ (a
 * minute passed, another locale or time zone), so React is told the text
 * may change during hydration.
 */
export function RelativeTime({ date }: { date: string }) {
  return (
    <time dateTime={date} title={new Date(date).toLocaleString()} suppressHydrationWarning>
      {timeAgo(date)}
    </time>
  );
}

export function LocalTime({ date }: { date: string }) {
  return (
    <time dateTime={date} suppressHydrationWarning>
      {new Date(date).toLocaleString()}
    </time>
  );
}
