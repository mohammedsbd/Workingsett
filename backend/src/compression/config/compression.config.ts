import { registerAs } from '@nestjs/config';
import {
  IsBooleanString,
  IsIn,
  IsUrl,
  Matches,
  ValidateIf,
} from 'class-validator';
import { UPSTREAMS, Upstream } from '../../proxy/providers/provider-adapter';
import validateConfig from '../../utils/validate-config';
import { CompressionConfig } from './compression-config.type';

/** Empty values (KEY= in .env) mean "use the default". */
const isSet = (_: object, value: unknown) =>
  value !== undefined && value !== null && value !== '';

// Checked as text: an empty value must stay empty, not become 0.
const WHOLE_NUMBER = /^\d+$/;
const POSITIVE_NUMBER = /^[1-9]\d*$/;

class EnvironmentVariablesValidator {
  @Matches(WHOLE_NUMBER)
  @ValidateIf(isSet)
  COMPRESSION_MIN_TOKENS: string;

  @IsBooleanString()
  @ValidateIf(isSet)
  COMPRESSION_WORKER: string;

  @Matches(POSITIVE_NUMBER)
  @ValidateIf(isSet)
  COMPRESSION_POLL_SECONDS: string;

  @Matches(WHOLE_NUMBER)
  @ValidateIf(isSet)
  COMPRESSION_RETRY_LIMIT: string;

  @IsIn(UPSTREAMS)
  @ValidateIf(isSet)
  PARSIM_INTERNAL_PROVIDER: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  @ValidateIf(isSet)
  PARSIM_INTERNAL_BASE_URL: string;
}

const intOr = (value: string | undefined, fallback: number) =>
  value ? parseInt(value, 10) : fallback;

const INTERNAL_KEYS: Record<Upstream, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export default registerAs<CompressionConfig>('compression', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  const provider = (process.env.PARSIM_INTERNAL_PROVIDER ||
    'gemini') as Upstream;
  return {
    minTokens: intOr(process.env.COMPRESSION_MIN_TOKENS, 6000),
    worker: process.env.COMPRESSION_WORKER !== 'false',
    pollSeconds: intOr(process.env.COMPRESSION_POLL_SECONDS, 2),
    retryLimit: intOr(process.env.COMPRESSION_RETRY_LIMIT, 2),
    internal: {
      provider,
      model: process.env.PARSIM_INTERNAL_MODEL?.trim() ?? '',
      baseUrl:
        process.env.PARSIM_INTERNAL_BASE_URL?.replace(/\/+$/, '') || undefined,
      apiKey: process.env[INTERNAL_KEYS[provider]] || undefined,
    },
  };
});
