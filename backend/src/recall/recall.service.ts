import { Injectable, Logger } from '@nestjs/common';
import { ArchivedItemRepository } from '../archived-items/infrastructure/persistence/archived-item.repository';
import { NewRecall } from '../recalls/infrastructure/persistence/recall.repository';
import { RecallRepository } from '../recalls/infrastructure/persistence/recall.repository';
import { RecallResult } from './recall-format';
import { RecallRound } from './recall-limit';
import {
  archivedText,
  RECALL_LIMIT_REACHED,
  recallNotFound,
} from './recall-tool';

/** What happened to one recall call, recorded after the response. */
export type RecallLogEntry = Pick<
  NewRecall,
  'archiveId' | 'found' | 'refused' | 'tokensRestored'
>;

/**
 * Answers parsim_recall calls from the archive and records them. Archives
 * are looked up per project, so one project can never recall another's.
 */
@Injectable()
export class RecallService {
  private readonly logger = new Logger(RecallService.name);

  constructor(
    private readonly archive: ArchivedItemRepository,
    private readonly recalls: RecallRepository,
  ) {}

  /** One tool result per call of the round, in call order. */
  async resolve(
    projectId: string,
    round: RecallRound,
  ): Promise<{ results: RecallResult[]; log: RecallLogEntry[] }> {
    const results: RecallResult[] = [];
    const log: RecallLogEntry[] = [];
    for (const call of round.fetch) {
      const item = await this.find(projectId, call.archiveId);
      results.push({
        call,
        text: item
          ? archivedText(item.content)
          : recallNotFound(call.archiveId),
      });
      log.push({
        archiveId: call.archiveId,
        found: item !== null,
        refused: false,
        tokensRestored: item?.tokenCount ?? 0,
      });
    }
    for (const call of round.refused) {
      results.push({ call, text: RECALL_LIMIT_REACHED });
      log.push({
        archiveId: call.archiveId,
        found: false,
        refused: true,
        tokensRestored: 0,
      });
    }
    return { results, log };
  }

  /** The archived item, or null if missing or the lookup failed. */
  private async find(projectId: string, archiveId: string) {
    if (!archiveId) return null;
    try {
      return await this.archive.findByArchiveId(projectId, archiveId);
    } catch (error) {
      // Fail open: the model is told the archive was not found.
      this.logger.error(
        `Could not read archive project=${projectId}: ${(error as Error)?.name ?? 'Error'}`,
      );
      return null;
    }
  }

  /** Stores the recalls of one client request. Never throws. */
  async record(
    log: RecallLogEntry[],
    ids: {
      projectId: string;
      agentSessionId: string | null;
      usageRecordId: string | null;
    },
  ): Promise<void> {
    if (!log.length) return;
    try {
      await this.recalls.createMany(log.map((entry) => ({ ...entry, ...ids })));
      this.logger.log(
        `recall project=${ids.projectId} calls=${log.length} found=${log.filter((e) => e.found).length} refused=${log.filter((e) => e.refused).length} tokensRestored=${log.reduce((sum, e) => sum + e.tokensRestored, 0)}`,
      );
    } catch (error) {
      this.logger.error(
        `Could not store recalls project=${ids.projectId}: ${(error as Error)?.name ?? 'Error'}`,
      );
    }
  }
}
