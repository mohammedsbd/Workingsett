import type { CustomUpstreamPolicy } from '../custom-upstream';

export type ProxyConfig = {
  /** When false, requests from localhost may omit the Parsim key (dev only). */
  requireKey: boolean;
  openaiBaseUrl: string;
  geminiBaseUrl: string;
  /** Gemini native API host; paths start with /v1beta/models. */
  geminiNativeBaseUrl: string;
  anthropicBaseUrl: string;
  /** Max wait for upstream headers, and max gap between streamed chunks. */
  upstreamTimeoutMs: number;
  /** Max request body size for proxy routes, in bytes or a size string. */
  bodyLimit: string;
  /** Base64 key (32 bytes) that encrypts stored provider keys. */
  encryptionKey?: string;
  /** Path of the editable model price table. */
  modelPricesPath: string;
  /** Most parsim_recall calls Parsim answers per client request; 0 turns recall off. */
  recallMaxPerRequest: number;
  /** Default for projects that do not set storeContent. */
  storeContentDefault: boolean;
  /** Log prompt and response content at debug level (DEBUG_CONTENT=true). */
  debugContent: boolean;
  /** Custom upstream base URLs (openai-compatible projects); see custom-upstream.ts. */
  customUpstream: CustomUpstreamPolicy;
};
