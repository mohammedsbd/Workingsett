import { Injectable, Logger } from '@nestjs/common';
import { Project } from '../projects/domain/project';
import { ProjectsService } from '../projects/projects.service';
import { ProxyApi } from '../proxy/providers/provider-adapter';
import { SnapshotPartRepository } from '../snapshot-parts/infrastructure/persistence/snapshot-part.repository';
import { RequestSnapshot, SnapshotBody } from './domain/request-snapshot';
import { RequestSnapshotRepository } from './infrastructure/persistence/request-snapshot.repository';
import { joinBody, partHash, splitBody, SplitBody } from './snapshot-body';

export type SnapshotInput = {
  project: Project;
  agentSessionId: string;
  requestNumber: number;
  usageRecordId: string | null;
  api: ProxyApi;
  model: string;
  streamed: boolean;
  /** The request as the client sent it. */
  original: Record<string, unknown>;
  /** The request as the GC made it, or null when the GC changed nothing. */
  gc: Record<string, unknown> | null;
};

/** A snapshot with both bodies rebuilt. */
export type LoadedSnapshot = {
  snapshot: RequestSnapshot;
  original: Record<string, unknown>;
  gc: Record<string, unknown> | null;
};

/**
 * Stores what each proxied request sent, so replay can rebuild it exactly
 * (see docs/replay.md). Only when the project stores content: envelopes and
 * messages are stored once per project by hash, and each request keeps the
 * list of hashes.
 */
@Injectable()
export class RequestSnapshotsService {
  private readonly logger = new Logger(RequestSnapshotsService.name);

  constructor(
    private readonly snapshots: RequestSnapshotRepository,
    private readonly parts: SnapshotPartRepository,
    private readonly projects: ProjectsService,
  ) {}

  /** Stores a request's snapshot when the project stores content. Never throws. */
  async record(input: SnapshotInput): Promise<void> {
    if (!this.projects.storesContent(input.project)) return;
    try {
      const original = splitBody(input.api, input.original);
      const gc = input.gc ? splitBody(input.api, input.gc) : null;
      const texts = [original, ...(gc ? [gc] : [])].flatMap((split) => [
        split.envelope,
        ...split.messages,
      ]);
      await this.parts.insertMissing(
        texts.map((json) => ({
          projectId: input.project.id,
          hash: partHash(json),
          json,
          sizeBytes: Buffer.byteLength(json),
        })),
      );
      await this.snapshots.insert({
        projectId: input.project.id,
        agentSessionId: input.agentSessionId,
        requestNumber: input.requestNumber,
        usageRecordId: input.usageRecordId,
        api: input.api,
        model: input.model,
        streamed: input.streamed,
        original: hashes(original),
        gc: gc && hashes(gc),
      });
    } catch (error) {
      this.logger.error(
        `Could not store request snapshot project=${input.project.id}: ${(error as Error)?.name ?? 'Error'}`,
      );
    }
  }

  findBySession(agentSessionId: string): Promise<RequestSnapshot[]> {
    return this.snapshots.findBySession(agentSessionId);
  }

  /** The request point rebuilt, or null if it has no complete snapshot. */
  async load(
    projectId: string,
    agentSessionId: string,
    requestNumber: number,
  ): Promise<LoadedSnapshot | null> {
    const snapshot = await this.snapshots.findOne(
      agentSessionId,
      requestNumber,
    );
    if (!snapshot || snapshot.projectId !== projectId) return null;
    const bodies = [snapshot.original, ...(snapshot.gc ? [snapshot.gc] : [])];
    const json = await this.parts.findJson(
      projectId,
      bodies.flatMap((body) => [body.envelope, ...body.messages]),
    );
    const rebuild = (body: SnapshotBody) => {
      const texts = [body.envelope, ...body.messages].map((h) => json.get(h));
      if (texts.some((text) => text === undefined)) return null;
      const [envelope, ...messages] = texts as string[];
      return joinBody(snapshot.api, envelope, messages);
    };
    const original = rebuild(snapshot.original);
    if (!original) return null;
    const gc = snapshot.gc ? rebuild(snapshot.gc) : null;
    if (snapshot.gc && !gc) return null;
    return { snapshot, original, gc };
  }
}

const hashes = (split: SplitBody): SnapshotBody => ({
  envelope: partHash(split.envelope),
  messages: split.messages.map(partHash),
});
