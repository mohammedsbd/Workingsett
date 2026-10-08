import { ApiProperty } from '@nestjs/swagger';

/**
 * One run of an agent, made of many proxied requests that share a growing
 * conversation. Not the boilerplate's login "session".
 */
export class AgentSession {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  projectId: string;

  /** From x-parsim-session-id, or "derived:<hash>" (see docs/agent-sessions.md). */
  @ApiProperty({ type: String })
  externalId: string;

  @ApiProperty({ enum: ['header', 'derived'] })
  idSource: 'header' | 'derived';

  /** The project's upstream when the session was seen ("openai", ...). */
  @ApiProperty({ type: String })
  provider: string;

  /** Model of the latest request. */
  @ApiProperty({ type: String })
  model: string;

  @ApiProperty()
  firstSeenAt: Date;

  @ApiProperty()
  lastSeenAt: Date;

  @ApiProperty({ type: Number })
  requestCount: number;
}
