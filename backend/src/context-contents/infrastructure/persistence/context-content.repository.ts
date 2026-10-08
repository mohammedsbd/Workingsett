import { NullableType } from '../../../utils/types/nullable.type';
import { ContextContent } from '../../domain/context-content';

export type NewContextContent = Pick<
  ContextContent,
  'projectId' | 'hash' | 'content' | 'sizeBytes'
>;

export abstract class ContextContentRepository {
  /** Inserts contents whose hash is new for the project; returns how many. */
  abstract insertMissing(contents: NewContextContent[]): Promise<number>;

  abstract findByHash(
    projectId: string,
    hash: string,
  ): Promise<NullableType<ContextContent>>;
}
