export type ProxyConfig = {
  /** When false, requests from localhost may omit the Parsim key (dev only). */
  requireKey: boolean;
  openaiBaseUrl: string;
  geminiBaseUrl: string;
  /** Max wait for upstream headers, and max gap between streamed chunks. */
  upstreamTimeoutMs: number;
  /** Max request body size for proxy routes, in bytes or a size string. */
  bodyLimit: string;
  /** Base64 key (32 bytes) that encrypts stored provider keys. */
  encryptionKey?: string;
  /** Path of the editable model price table. */
  modelPricesPath: string;
};
