import { registerAs } from '@nestjs/config';
import path from 'node:path';
import {
  IsBooleanString,
  IsInt,
  IsString,
  IsUrl,
  Min,
  ValidateIf,
} from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { ProxyConfig } from './proxy-config.type';

/** Empty values (KEY= in .env) mean "use the default". */
const isSet = (_: object, value: unknown) =>
  value !== undefined && value !== null && value !== '';

class EnvironmentVariablesValidator {
  @IsBooleanString()
  @ValidateIf(isSet)
  PARSIM_REQUIRE_KEY: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  @ValidateIf(isSet)
  PROXY_OPENAI_BASE_URL: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  @ValidateIf(isSet)
  PROXY_GEMINI_BASE_URL: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  @ValidateIf(isSet)
  PROXY_ANTHROPIC_BASE_URL: string;

  @IsInt()
  @Min(1)
  @ValidateIf(isSet)
  PROXY_UPSTREAM_TIMEOUT_MS: number;

  @IsString()
  @ValidateIf(isSet)
  PROXY_BODY_LIMIT: string;

  @IsString()
  @ValidateIf(isSet)
  PARSIM_ENCRYPTION_KEY: string;

  @IsString()
  @ValidateIf(isSet)
  PARSIM_MODEL_PRICES_PATH: string;
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export default registerAs<ProxyConfig>('proxy', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    requireKey: process.env.PARSIM_REQUIRE_KEY !== 'false',
    openaiBaseUrl: trimSlash(
      process.env.PROXY_OPENAI_BASE_URL || 'https://api.openai.com',
    ),
    geminiBaseUrl: trimSlash(
      process.env.PROXY_GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai',
    ),
    anthropicBaseUrl: trimSlash(
      process.env.PROXY_ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    ),
    upstreamTimeoutMs: process.env.PROXY_UPSTREAM_TIMEOUT_MS
      ? parseInt(process.env.PROXY_UPSTREAM_TIMEOUT_MS, 10)
      : 600_000,
    bodyLimit: process.env.PROXY_BODY_LIMIT || '32mb',
    encryptionKey: process.env.PARSIM_ENCRYPTION_KEY || undefined,
    modelPricesPath: path.resolve(
      process.env.PARSIM_MODEL_PRICES_PATH || 'config/model-prices.json',
    ),
  };
});
