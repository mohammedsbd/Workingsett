import { NullableType } from '../../../utils/types/nullable.type';
import { Project } from '../../domain/project';

export type NewProject = Pick<
  Project,
  'name' | 'upstream' | 'ownerId' | 'providerKeyEncrypted' | 'storeContent'
>;

export type ProjectChanges = Partial<
  Pick<Project, 'name' | 'upstream' | 'providerKeyEncrypted' | 'storeContent'>
>;

export abstract class ProjectRepository {
  abstract create(data: NewProject): Promise<Project>;

  /** Projects owned by a user, oldest first. */
  abstract findByOwner(ownerId: Project['ownerId']): Promise<Project[]>;

  abstract findById(id: Project['id']): Promise<NullableType<Project>>;

  /** The oldest project overall (used by the dev-only keyless mode). */
  abstract findOldest(): Promise<NullableType<Project>>;

  abstract update(
    id: Project['id'],
    changes: ProjectChanges,
  ): Promise<NullableType<Project>>;
}
