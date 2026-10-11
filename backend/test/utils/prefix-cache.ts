/**
 * A simple model of provider prompt caching, to compare sessions with and
 * without the GC offline: a request's cached tokens are the tokens of the
 * longest run of leading messages it shares, byte for byte, with the
 * session's previous request (which providers have just cached). Real
 * providers cache at token level, need a minimum prefix length (1,024 or
 * more tokens) and may evict, so this is an upper bound for both runs.
 */
export type CacheReplay = {
  requests: number;
  inputTokens: number;
  cachedTokens: number;
  /** Requests whose whole previous request was a cached prefix. */
  fullPrefixHits: number;
};

export function replayPrefixCache(
  /** The messages (or contents) each request sent upstream, in order. */
  requests: unknown[][],
  countTokens: (text: string) => number,
): CacheReplay {
  let previous: string[] = [];
  const replay: CacheReplay = {
    requests: requests.length,
    inputTokens: 0,
    cachedTokens: 0,
    fullPrefixHits: 0,
  };
  for (const messages of requests) {
    const serialized = messages.map((m) => JSON.stringify(m));
    const tokens = serialized.map(countTokens);
    let shared = 0;
    while (
      shared < previous.length &&
      shared < serialized.length &&
      previous[shared] === serialized[shared]
    ) {
      shared += 1;
    }
    replay.inputTokens += tokens.reduce((sum, t) => sum + t, 0);
    replay.cachedTokens += tokens
      .slice(0, shared)
      .reduce((sum, t) => sum + t, 0);
    if (previous.length && shared === previous.length)
      replay.fullPrefixHits += 1;
    previous = serialized;
  }
  return replay;
}
