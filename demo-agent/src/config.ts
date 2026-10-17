import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, type ProviderName } from './llm/types.js';

/** The demo-agent folder (this file is in src/). */
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** Loads demo-agent/.env (never committed). Existing variables win. */
export function loadEnv(): void {
  loadDotenv({ path: path.join(ROOT, '.env'), quiet: true });
}

/** Where requests go: straight to the provider, or through Parsim. */
export const ROUTES = ['direct', 'parsim'] as const;
export type Route = (typeof ROUTES)[number];

export type ProviderConfig = {
  provider: ProviderName;
  /** From <PROVIDER>_MODEL; never hardcoded. */
  model: string;
  /** The provider key (sent upstream; through Parsim, as the provider key). */
  apiKey: string;
  /** The SDK base URL, or undefined for the SDK default. */
  baseUrl?: string;
  /** Extra headers (the Parsim key and the session id go through these). */
  headers: Record<string, string>;
  /** The model's context window, if configured. */
  contextTokens?: number;
  /** A per-request token limit below the window (free tier tokens per minute). */
  maxRequestTokens?: number;
  maxOutputTokens: number;
  /** null: do not send a temperature (some models only accept the default). */
  temperature: number | null;
  /** A free tier: development runs only, never real customer data. */
  freeTier: boolean;
  route: Route;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const PREFIX: Record<ProviderName, string> = {
  gemini: 'GEMINI',
  groq: 'GROQ',
  openai: 'OPENAI',
  anthropic: 'ANTHROPIC',
};

/** Default direct base URLs that the SDKs do not already know. */
const DIRECT_BASE_URL: Partial<Record<ProviderName, string>> = {
  groq: 'https://api.groq.com/openai/v1',
};

const positiveInt = (value: string | undefined, name: string) => {
  if (!value) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ConfigError(`${name} must be a positive whole number.`);
  }
  return Number(value);
};

/**
 * The SDK base URL for a provider through Parsim. OpenAI-format SDKs add
 * /chat/completions to a base ending in /v1; the Anthropic and Gemini SDKs
 * add /v1/messages and /v1beta/... themselves.
 */
export function parsimBaseUrl(provider: ProviderName, parsimUrl: string) {
  const root = parsimUrl.trim().replace(/\/+$/, '');
  return provider === 'openai' || provider === 'groq' ? `${root}/v1` : root;
}

/** A direct provider config, sent through Parsim with a project's key. */
export function viaParsim(
  config: ProviderConfig,
  parsimUrl: string,
  parsimKey: string,
): ProviderConfig {
  return {
    ...config,
    baseUrl: parsimBaseUrl(config.provider, parsimUrl),
    headers: { ...config.headers, 'x-parsim-key': parsimKey },
    route: 'parsim',
  };
}

export function isProvider(value: string): value is ProviderName {
  return (PROVIDERS as readonly string[]).includes(value);
}

/**
 * The provider configuration from the environment.
 *
 * - Model and key: <PROVIDER>_MODEL and <PROVIDER>_API_KEY (GEMINI_*, GROQ_*,
 *   OPENAI_*, ANTHROPIC_*).
 * - Limits: <PROVIDER>_CONTEXT_TOKENS and <PROVIDER>_MAX_REQUEST_TOKENS.
 * - Through Parsim (route "parsim"): PARSIM_BASE_URL and PARSIM_API_KEY. The
 *   SDK points at Parsim, the Parsim key goes in x-parsim-key and the
 *   provider key stays the SDK's API key (Parsim forwards with it).
 */
export function providerConfig(
  provider: ProviderName,
  route: Route,
  env: Env = process.env,
): ProviderConfig {
  const prefix = PREFIX[provider];
  const model = env[`${prefix}_MODEL`]?.trim();
  if (!model) {
    throw new ConfigError(
      `${prefix}_MODEL is not set. Set the model to use in demo-agent/.env.`,
    );
  }
  const apiKey = env[`${prefix}_API_KEY`]?.trim();
  if (!apiKey) {
    throw new ConfigError(`${prefix}_API_KEY is not set in demo-agent/.env.`);
  }
  const headers: Record<string, string> = {};
  let baseUrl =
    env[`${prefix}_BASE_URL`]?.trim() || DIRECT_BASE_URL[provider] || undefined;
  if (route === 'parsim') {
    const parsim = env.PARSIM_BASE_URL?.trim();
    const parsimKey = env.PARSIM_API_KEY?.trim();
    if (!parsim || !parsimKey) {
      throw new ConfigError(
        'Running through Parsim needs PARSIM_BASE_URL and PARSIM_API_KEY in demo-agent/.env.',
      );
    }
    baseUrl = parsimBaseUrl(provider, parsim);
    headers['x-parsim-key'] = parsimKey;
  }
  const temperature = env.DEMO_TEMPERATURE ?? '0';
  return {
    provider,
    model,
    apiKey,
    baseUrl,
    headers,
    contextTokens: positiveInt(
      env[`${prefix}_CONTEXT_TOKENS`],
      `${prefix}_CONTEXT_TOKENS`,
    ),
    maxRequestTokens: positiveInt(
      env[`${prefix}_MAX_REQUEST_TOKENS`],
      `${prefix}_MAX_REQUEST_TOKENS`,
    ),
    maxOutputTokens:
      positiveInt(env.DEMO_MAX_OUTPUT_TOKENS, 'DEMO_MAX_OUTPUT_TOKENS') ?? 2048,
    temperature: temperature === '' ? null : Number(temperature),
    freeTier: env[`${prefix}_FREE_TIER`] === 'true',
    route,
  };
}
