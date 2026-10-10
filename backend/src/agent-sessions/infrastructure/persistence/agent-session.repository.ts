import { NullableType } from '../../../utils/types/nullable.type';
import { AgentSession } from '../../domain/agent-session';

export type SessionSighting = Pick<
  AgentSession,
  'projectId' | 'externalId' | 'idSource' | 'provider' | 'model'
> & { at: Date };

export abstract class AgentSessionRepository {
  /**
   * Creates the session or updates it for one more request, atomically:
   * requestCount goes up by one and lastSeenAt and model are updated.
   * Returns the session after the update.
   */
  abstract recordRequest(sighting: SessionSighting): Promise<AgentSession>;

  /** The session with this external id, if the project has seen it. */
  abstract findByExternalId(
    projectId: string,
    externalId: string,
  ): Promise<NullableType<AgentSession>>;

  /** Sessions of a project, most recently seen first. */
  abstract findByProject(projectId: string): Promise<AgentSession[]>;
}
