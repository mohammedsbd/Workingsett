import {
  getEncoding,
  getEncodingNameForModel,
  Tiktoken,
  TiktokenEncoding,
} from 'js-tiktoken';
import { Upstream } from '../proxy/providers/provider-adapter';

/**
 * Tokens per image, used for every provider. OpenAI charges 85 tokens for a
 * low-detail image and more for larger ones; Anthropic and Gemini also
 * scale with size. This is a floor, not an exact count.
 */
export const IMAGE_TOKENS = 85;

const FALLBACK_ENCODING: TiktokenEncoding = 'o200k_base';

export type TokenCount = {
  tokens: number;
  /**
   * How the count was made: "tiktoken:<encoding>" for OpenAI models (the
   * same tokenizer OpenAI uses), "approx:<encoding>" for Anthropic and
   * Gemini, which use their own tokenizers.
   */
  tokenizer: string;
};

/**
 * Counts tokens in stored context items. These counts drive GC decisions;
 * the usage the provider reports stays the source of truth for billing.
 */
export class TokenCounter {
  private readonly encoders = new Map<TiktokenEncoding, Tiktoken>();

  count(
    text: string,
    imageCount: number,
    target: { upstream: Upstream; model: string },
  ): TokenCount {
    const { encoding, exact } = this.encodingFor(target);
    const tokens =
      this.encoder(encoding).encode(text).length + imageCount * IMAGE_TOKENS;
    return {
      tokens,
      tokenizer: `${exact ? 'tiktoken' : 'approx'}:${encoding}`,
    };
  }

  private encodingFor(target: { upstream: Upstream; model: string }): {
    encoding: TiktokenEncoding;
    exact: boolean;
  } {
    if (target.upstream === 'openai') {
      try {
        return {
          encoding: getEncodingNameForModel(
            target.model as Parameters<typeof getEncodingNameForModel>[0],
          ),
          exact: true,
        };
      } catch {
        // A model js-tiktoken does not know yet: new OpenAI models use o200k.
        return { encoding: FALLBACK_ENCODING, exact: false };
      }
    }
    return { encoding: FALLBACK_ENCODING, exact: false };
  }

  private encoder(encoding: TiktokenEncoding): Tiktoken {
    let encoder = this.encoders.get(encoding);
    if (!encoder) {
      encoder = getEncoding(encoding);
      this.encoders.set(encoding, encoder);
    }
    return encoder;
  }
}
