import { NullableType } from '../../../utils/types/nullable.type';
import { ArchivedItem } from '../../domain/archived-item';

export type NewArchivedItem = Omit<ArchivedItem, 'id' | 'createdAt'>;

export abstract class ArchivedItemRepository {
  /**
   * Stores items not archived yet (same project and archive id). Returns
   * how many were new.
   */
  abstract insertMissing(items: NewArchivedItem[]): Promise<number>;

  abstract findByArchiveId(
    projectId: string,
    archiveId: string,
  ): Promise<NullableType<ArchivedItem>>;
}
