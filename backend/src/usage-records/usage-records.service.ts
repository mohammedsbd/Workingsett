import { Injectable } from '@nestjs/common';
import { TokenUsage } from './domain/token-usage';
import { UsageRecord } from './domain/usage-record';
import { UsageRecordRepository } from './infrastructure/persistence/usage-record.repository';
import { ModelPricingService } from './pricing/model-pricing.service';

export type ProxiedRequestOutcome = {
  projectId: string;
  upstream: string;
  model: string;
  /** Null when the upstream reported no usage (errors, aborted streams). */
  usage: TokenUsage | null;
  latencyMs: number;
  status: number;
  streamed: boolean;
};

@Injectable()
export class UsageRecordsService {
  constructor(
    private readonly repository: UsageRecordRepository,
    private readonly pricing: ModelPricingService,
  ) {}

  /** Stores one proxied request with its cost. Takes no content. */
  record(outcome: ProxiedRequestOutcome): Promise<UsageRecord> {
    const usage = outcome.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
    };
    return this.repository.create({
      projectId: outcome.projectId,
      upstream: outcome.upstream,
      model: outcome.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      costUsd: outcome.usage
        ? this.pricing.costUsd(outcome.model, usage)
        : null,
      latencyMs: outcome.latencyMs,
      status: outcome.status,
      streamed: outcome.streamed,
    });
  }

  findByProject(projectId: string): Promise<UsageRecord[]> {
    return this.repository.findByProject(projectId);
  }
}
