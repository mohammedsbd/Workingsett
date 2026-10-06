import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One proxied request: tokens, cost and timing. Never holds prompt or
 * response content.
 */
export class UsageRecord {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  projectId: string;

  /** "openai" or "gemini". */
  @ApiProperty({ type: String })
  upstream: string;

  /** The model the client asked for. */
  @ApiProperty({ type: String })
  model: string;

  @ApiProperty({ type: Number })
  inputTokens: number;

  @ApiProperty({ type: Number })
  outputTokens: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  cachedInputTokens: number | null;

  /** USD; null when the model is not in the price table. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  costUsd: number | null;

  /** Time until the full response was sent, in milliseconds. */
  @ApiProperty({ type: Number })
  latencyMs: number;

  /** HTTP status returned to the client (499 if the client disconnected). */
  @ApiProperty({ type: Number })
  status: number;

  @ApiProperty({ type: Boolean })
  streamed: boolean;

  @ApiProperty()
  createdAt: Date;
}

export type NewUsageRecord = Omit<UsageRecord, 'id' | 'createdAt'>;
