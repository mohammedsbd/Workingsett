import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';

/**
 * Forwards to Gemini's OpenAI-compatible endpoint:
 * {PROXY_GEMINI_BASE_URL}/chat/completions, where the base already ends in
 * /v1beta/openai.
 *
 * Differences from OpenAI, observed on 2026-10-06 (see docs/proxy.md):
 * - usage.completion_tokens leaves out thinking tokens, but total_tokens
 *   includes them and they are billed as output. Output = total - prompt.
 * - With stream_options.include_usage, every content chunk carries usage
 *   (there is no separate usage-only chunk). The stream filter strips it when
 *   Parsim injected the option.
 * - Errors come back as a JSON array, [{"error": {...}}]. They are passed
 *   through unchanged, like every upstream error.
 */
@Injectable()
export class GeminiOpenAiAdapter extends OpenAiCompatibleAdapter {
  readonly upstream = 'gemini' as const;
  protected readonly outputFromTotal = true;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    super();
  }

  protected chatCompletionsUrl(): string {
    const base = this.configService.getOrThrow('proxy.geminiBaseUrl', {
      infer: true,
    });
    return `${base}/chat/completions`;
  }
}
