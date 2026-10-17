import { registerAs } from '@nestjs/config';
import path from 'node:path';
import {
  IsBooleanString,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { DEFAULT_CUSTOM_UPSTREAM_HOSTS } from '../custom-upstream';
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
  PROXY_GEMINI_NATIVE_BASE_URL: string;

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

  @Matches(/^\d+$/)
  @ValidateIf(isSet)
  PARSIM_RECALL_MAX_PER_REQUEST: string;

  @IsBooleanString()
  @ValidateIf(isSet)
  PARSIM_STORE_CONTENT: string;

  @IsBooleanString()
  @ValidateIf(isSet)
  DEBUG_CONTENT: string;

  @IsBooleanString()
  @ValidateIf(isSet)
  PARSIM_ALLOW_CUSTOM_UPSTREAM: string;

  @IsString()
  @ValidateIf(isSet)
  PARSIM_CUSTOM_UPSTREAM_HOSTS: string;
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
    geminiNativeBaseUrl: trimSlash(
      process.env.PROXY_GEMINI_NATIVE_BASE_URL ||
        'https://generativelanguage.googleapis.com',
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
    recallMaxPerRequest: process.env.PARSIM_RECALL_MAX_PER_REQUEST
      ? parseInt(process.env.PARSIM_RECALL_MAX_PER_REQUEST, 10)
      : 3,
    // On by default outside production, so development keeps full context.
    storeContentDefault: process.env.PARSIM_STORE_CONTENT
      ? process.env.PARSIM_STORE_CONTENT === 'true'
      : process.env.NODE_ENV !== 'production',
    debugContent: process.env.DEBUG_CONTENT === 'true',
    customUpstream: {
      // Never in production, whatever the env says.
      allowAny:
        process.env.PARSIM_ALLOW_CUSTOM_UPSTREAM === 'true' &&
        process.env.NODE_ENV !== 'production',
      hosts: process.env.PARSIM_CUSTOM_UPSTREAM_HOSTS
        ? process.env.PARSIM_CUSTOM_UPSTREAM_HOSTS.split(',')
            .map((host) => host.trim().toLowerCase())
            .filter(Boolean)
        : DEFAULT_CUSTOM_UPSTREAM_HOSTS,
    },
  };
});
