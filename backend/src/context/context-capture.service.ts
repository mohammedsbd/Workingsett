import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentSessionRepository } from '../agent-sessions/infrastructure/persistence/agent-session.repository';
import { AllConfigType } from '../config/config.type';
import { ContextContentRepository } from '../context-contents/infrastructure/persistence/context-content.repository';
import { ContextItemRepository } from '../context-items/infrastructure/persistence/context-item.repository';
import { Project } from '../projects/domain/project';
import { Upstream } from '../proxy/providers/provider-adapter';
import { canonicalJson } from './canonical-json';
import { extractContextItems } from './context-items';
import { isObject, MessageConverter } from './normalization/internal-model';
import { resolveSessionId } from './session-id';
import { TokenCounter } from './token-counter';

export type CaptureInput = {
  project: Project;
  upstream: Upstream;
  converter: MessageConverter;
  rawBody: Buffer;
  /** Value of the x-parsim-session-id header, if any. */
  sessionHeader: unknown;
  at: Date;
};

export type CaptureResult = {
  agentSessionId: string;
  requestNumber: number;
  items: number;
  newItems: number;
  newContents: number;
};

const DEBUG_PREVIEW_CHARS = 200;

/**
 * Stores what a proxied request contained: finds or creates the agent
 * session, then records every context item that is new for that session,
 * with its token count, and (if the project stores content) its content,
 * deduplicated by hash. Runs after the response has been sent.
 */
@Injectable()
export class ContextCaptureService {
  private readonly logger = new Logger(ContextCaptureService.name);
  private readonly tokens = new TokenCounter();

  constructor(
    private readonly sessions: AgentSessionRepository,
    private readonly items: ContextItemRepository,
    private readonly contents: ContextContentRepository,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const body: unknown = JSON.parse(input.rawBody.toString('utf8'));
    if (!isObject(body)) throw new Error('Request body is not a JSON object');

    const request = input.converter.toInternal(body);
    const extracted = extractContextItems(request);
    const identity = resolveSessionId({
      header: input.sessionHeader,
      upstream: input.upstream,
      model: request.model,
      items: extracted,
    });

    const session = await this.sessions.recordRequest({
      projectId: input.project.id,
      externalId: identity.externalId,
      idSource: identity.source,
      provider: input.upstream,
      model: request.model,
      at: input.at,
    });

    const known = new Set(
      (await this.items.findKeys(session.id)).map(
        (key) => `${key.position}:${key.contentHash}`,
      ),
    );
    const fresh = extracted.filter(
      (item) => !known.has(`${item.position}:${item.contentHash}`),
    );

    let newContents = 0;
    if (this.storesContent(input.project) && fresh.length) {
      newContents = await this.contents.insertMissing(
        fresh.map((item) => {
          const json = canonicalJson(item.content);
          return {
            projectId: input.project.id,
            hash: item.contentHash,
            content: item.content,
            sizeBytes: Buffer.byteLength(json),
          };
        }),
      );
    }

    const newItems = await this.items.insertMissing(
      fresh.map((item) => {
        const count = this.tokens.count(item.tokenText, item.imageCount, {
          upstream: input.upstream,
          model: request.model,
        });
        return {
          agentSessionId: session.id,
          position: item.position,
          role: item.role,
          kind: item.kind,
          toolCallId: item.toolCallId,
          contentHash: item.contentHash,
          tokenCount: count.tokens,
          tokenizer: count.tokenizer,
          firstSeenRequest: session.requestCount,
        };
      }),
    );

    this.logger.log(
      `context session=${session.id} request=${session.requestCount} items=${extracted.length} newItems=${newItems} newContents=${newContents}`,
    );
    if (this.configService.get('proxy.debugContent', { infer: true })) {
      for (const item of fresh) {
        this.logger.debug(
          `context item session=${session.id} position=${item.position} kind=${item.kind}: ${item.tokenText.slice(0, DEBUG_PREVIEW_CHARS)}`,
        );
      }
    }

    return {
      agentSessionId: session.id,
      requestNumber: session.requestCount,
      items: extracted.length,
      newItems,
      newContents,
    };
  }

  private storesContent(project: Project): boolean {
    return (
      project.storeContent ??
      this.configService.getOrThrow('proxy.storeContentDefault', {
        infer: true,
      })
    );
  }
}
