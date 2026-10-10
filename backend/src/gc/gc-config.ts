/** Per-project GC mode. */
export const GC_MODES = ['off', 'shadow', 'on'] as const;
export type GcMode = (typeof GC_MODES)[number];

/**
 * Tool name patterns that mark a tool as having side effects. A pattern
 * ending in "_" matches a name that starts with it, or contains it after
 * another word ("gmail_send_email"); any other pattern matches anywhere in
 * the name ("pay" also matches "process_payment"). Names are compared in
 * snake case, so "sendEmail" counts as "send_email". Matching too much only
 * keeps more context; matching too little would break the action log.
 */
export const DEFAULT_SIDE_EFFECT_PATTERNS: readonly string[] = [
  'send_',
  'create_',
  'delete_',
  'update_',
  'pay',
  'refund',
];

export type GcConfig = {
  /** New decisions are made only when the context is above this many tokens. */
  minContextTokens: number;
  /** The last N turns are never changed. */
  protectedTurns: number;
  /** Tool results above this many tokens can be archived... */
  archiveMinTokens: number;
  /** ...once they are more than this many turns old. */
  archiveAfterTurns: number;
  /** Tool names with side effects, matched exactly (case-insensitive). */
  sideEffectTools: readonly string[];
  /** Name patterns with side effects; see DEFAULT_SIDE_EFFECT_PATTERNS. */
  sideEffectPatterns: readonly string[];
};

export const DEFAULT_GC_CONFIG: GcConfig = {
  minContextTokens: 8000,
  protectedTurns: 6,
  archiveMinTokens: 1500,
  archiveAfterTurns: 6,
  sideEffectTools: [],
  sideEffectPatterns: DEFAULT_SIDE_EFFECT_PATTERNS,
};

/** "sendEmail", "Send-Email" and "send.email" all become "send_email". */
export function snakeCaseToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}

/** Whether calls to this tool change something outside the conversation. */
export function hasSideEffects(name: string, config: GcConfig): boolean {
  const lower = name.toLowerCase();
  if (config.sideEffectTools.some((tool) => tool.toLowerCase() === lower)) {
    return true;
  }
  const snake = snakeCaseToolName(name);
  return config.sideEffectPatterns.some((raw) => {
    const pattern = raw.toLowerCase();
    if (!pattern) return false;
    if (pattern.endsWith('_')) {
      return snake.startsWith(pattern) || snake.includes(`_${pattern}`);
    }
    return snake.includes(pattern);
  });
}
