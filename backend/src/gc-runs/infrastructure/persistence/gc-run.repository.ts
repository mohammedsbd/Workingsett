import { GcRun } from '../../domain/gc-run';

export type NewGcRun = Omit<GcRun, 'id' | 'createdAt'>;

export abstract class GcRunRepository {
  abstract create(run: NewGcRun): Promise<GcRun>;

  /** Runs of a project, oldest first. */
  abstract findByProject(projectId: string): Promise<GcRun[]>;
}
