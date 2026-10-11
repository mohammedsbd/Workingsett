import { ProxyApi } from '../proxy/providers/provider-adapter';
import { anthropicRecall } from './anthropic-recall';
import { geminiRecall } from './gemini-recall';
import { openAiRecall } from './openai-recall';
import { RecallFormat } from './recall-format';

/** The parsim_recall handling for each client API. */
export const RECALL_FORMATS: Record<ProxyApi, RecallFormat> = {
  'openai-chat': openAiRecall,
  'anthropic-messages': anthropicRecall,
  'gemini-native': geminiRecall,
};
