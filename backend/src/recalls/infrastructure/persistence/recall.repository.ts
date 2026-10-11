import { Recall } from '../../domain/recall';

export type NewRecall = Omit<Recall, 'id' | 'createdAt'>;

export abstract class RecallRepository {
  abstract createMany(recalls: NewRecall[]): Promise<void>;

  /** Recalls of a project, oldest first. */
  abstract findByProject(projectId: string): Promise<Recall[]>;
}
