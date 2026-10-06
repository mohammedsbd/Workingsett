import { NewUsageRecord, UsageRecord } from '../../domain/usage-record';

export abstract class UsageRecordRepository {
  abstract create(data: NewUsageRecord): Promise<UsageRecord>;

  /** Records of a project, newest first. */
  abstract findByProject(projectId: string): Promise<UsageRecord[]>;
}
