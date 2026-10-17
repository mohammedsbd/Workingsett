import { Injectable } from '@nestjs/common';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';

/**
 * Forwards to an "openai-compatible" project's own base URL (for example
 * Groq at https://api.groq.com/openai/v1): {upstreamBaseUrl}/chat/completions.
 * The proxy checks the URL against the custom upstream policy before every
 * request (see custom-upstream.ts).
 */
@Injectable()
export class CustomOpenAiAdapter extends OpenAiCompatibleAdapter {
  readonly upstream = 'openai-compatible' as const;

  protected chatCompletionsUrl(upstreamBaseUrl?: string): string {
    if (!upstreamBaseUrl) {
      throw new Error('An openai-compatible project needs a base URL');
    }
    return `${upstreamBaseUrl}/chat/completions`;
  }
}
