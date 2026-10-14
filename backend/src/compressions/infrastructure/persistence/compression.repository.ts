import { NullableType } from '../../../utils/types/nullable.type';
import { Compression } from '../../domain/compression';

export type NewCompression = Pick<
  Compression,
  | 'projectId'
  | 'agentSessionId'
  | 'stretchKey'
  | 'startIndex'
  | 'endIndex'
  | 'firstTurn'
  | 'lastTurn'
  | 'input'
  | 'tokensBefore'
>;

export abstract class CompressionRepository {
  /** Creates a pending compression; null if this stretch already has one. */
  abstract createPending(
    compression: NewCompression,
  ): Promise<NullableType<Compression>>;

  abstract findById(id: string): Promise<NullableType<Compression>>;

  /** Compressions of a session in conversation order. */
  abstract findBySession(agentSessionId: string): Promise<Compression[]>;

  abstract markReady(
    id: string,
    result: Pick<Compression, 'stateBlock' | 'tokensAfter' | 'usageRecordId'>,
  ): Promise<void>;

  abstract markFailed(id: string, error: string): Promise<void>;
}
