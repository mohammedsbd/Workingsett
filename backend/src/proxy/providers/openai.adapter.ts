import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';

/** Forwards to OpenAI: {PROXY_OPENAI_BASE_URL}/v1/chat/completions. */
@Injectable()
export class OpenAiAdapter extends OpenAiCompatibleAdapter {
  readonly upstream = 'openai' as const;
  protected readonly forwardedHeaders = [
    'openai-organization',
    'openai-project',
  ];

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    super();
  }

  protected chatCompletionsUrl(): string {
    const base = this.configService.getOrThrow('proxy.openaiBaseUrl', {
      infer: true,
    });
    return `${base}/v1/chat/completions`;
  }
}
