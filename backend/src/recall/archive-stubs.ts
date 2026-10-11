/** Matches the GC's archive stub and captures its archive id. */
const ARCHIVE_STUB = /\[parsim archived: [^\]]*?, id (arc_[0-9a-f]{16})\]/g;

/**
 * The archive ids of every archive stub in a request body (as JSON text),
 * in order, without repeats. Works for every format, since the stub text
 * needs no JSON escaping.
 */
export function archiveStubIds(body: string): string[] {
  return [...new Set([...body.matchAll(ARCHIVE_STUB)].map((m) => m[1]))];
}
