import { NullableType } from '../../../utils/types/nullable.type';
import { ParsimApiKey } from '../../domain/parsim-api-key';

export type NewParsimApiKey = Pick<
  ParsimApiKey,
  'projectId' | 'name' | 'prefix' | 'keyHash'
>;

export abstract class ParsimApiKeyRepository {
  abstract create(data: NewParsimApiKey): Promise<ParsimApiKey>;

  abstract findByHash(keyHash: string): Promise<NullableType<ParsimApiKey>>;

  /** Keys of a project, newest first, including revoked ones. */
  abstract findByProject(projectId: string): Promise<ParsimApiKey[]>;

  abstract findById(
    id: ParsimApiKey['id'],
  ): Promise<NullableType<ParsimApiKey>>;

  abstract markUsed(id: ParsimApiKey['id'], at: Date): Promise<void>;

  /** Sets revokedAt if not already set; returns the key. */
  abstract revoke(
    id: ParsimApiKey['id'],
    at: Date,
  ): Promise<NullableType<ParsimApiKey>>;
}
