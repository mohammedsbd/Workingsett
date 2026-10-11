import { registerAs } from '@nestjs/config';
import { IsString, Matches, ValidateIf } from 'class-validator';
import {
  DEFAULT_GC_CONFIG,
  DEFAULT_SIDE_EFFECT_PATTERNS,
  GcConfig,
} from '../../gc/gc-config';
import validateConfig from '../../utils/validate-config';

/** Empty values (KEY= in .env) mean "use the default". */
const isSet = (_: object, value: unknown) =>
  value !== undefined && value !== null && value !== '';

// Checked as text: an empty value must stay empty, not become 0.
const WHOLE_NUMBER = /^\d+$/;
const POSITIVE_NUMBER = /^[1-9]\d*$/;

class EnvironmentVariablesValidator {
  @Matches(WHOLE_NUMBER)
  @ValidateIf(isSet)
  GC_MIN_CONTEXT_TOKENS: string;

  @Matches(POSITIVE_NUMBER)
  @ValidateIf(isSet)
  GC_PROTECTED_TURNS: string;

  @Matches(WHOLE_NUMBER)
  @ValidateIf(isSet)
  GC_ARCHIVE_MIN_TOKENS: string;

  @Matches(POSITIVE_NUMBER)
  @ValidateIf(isSet)
  GC_ARCHIVE_AFTER_TURNS: string;

  @IsString()
  @ValidateIf(isSet)
  GC_SIDE_EFFECT_TOOLS: string;

  @IsString()
  @ValidateIf(isSet)
  GC_SIDE_EFFECT_PATTERNS: string;
}

const intOr = (value: string | undefined, fallback: number) =>
  value ? parseInt(value, 10) : fallback;

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** GC settings shared by every project (the mode is per project). */
export default registerAs<GcConfig>('gc', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    minContextTokens: intOr(
      process.env.GC_MIN_CONTEXT_TOKENS,
      DEFAULT_GC_CONFIG.minContextTokens,
    ),
    protectedTurns: intOr(
      process.env.GC_PROTECTED_TURNS,
      DEFAULT_GC_CONFIG.protectedTurns,
    ),
    archiveMinTokens: intOr(
      process.env.GC_ARCHIVE_MIN_TOKENS,
      DEFAULT_GC_CONFIG.archiveMinTokens,
    ),
    archiveAfterTurns: intOr(
      process.env.GC_ARCHIVE_AFTER_TURNS,
      DEFAULT_GC_CONFIG.archiveAfterTurns,
    ),
    sideEffectTools: list(process.env.GC_SIDE_EFFECT_TOOLS),
    // Extra patterns add to the defaults; the defaults always apply.
    sideEffectPatterns: [
      ...DEFAULT_SIDE_EFFECT_PATTERNS,
      ...list(process.env.GC_SIDE_EFFECT_PATTERNS),
    ],
  };
});
