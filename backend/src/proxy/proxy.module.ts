import { Module } from '@nestjs/common';
import { RelationalAgentSessionPersistenceModule } from '../agent-sessions/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalArchivedItemPersistenceModule } from '../archived-items/infrastructure/persistence/relational/relational-persistence.module';
import { CompressionModule } from '../compression/compression.module';
import { ContextModule } from '../context/context.module';
import { RelationalGcDecisionPersistenceModule } from '../gc-decisions/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalGcRunPersistenceModule } from '../gc-runs/infrastructure/persistence/relational/relational-persistence.module';
import { ParsimApiKeysModule } from '../parsim-api-keys/parsim-api-keys.module';
import { ProjectsModule } from '../projects/projects.module';
import { RequestSnapshotsModule } from '../request-snapshots/request-snapshots.module';
import { UsageRecordsModule } from '../usage-records/usage-records.module';
import { ChatCompletionsController } from './chat-completions.controller';
import { GeminiController } from './gemini.controller';
import { MessagesController } from './messages.controller';
import { AnthropicAdapter } from './providers/anthropic.adapter';
import { CustomOpenAiAdapter } from './providers/custom-openai.adapter';
import { GeminiNativeAdapter } from './providers/gemini-native.adapter';
import { GeminiOpenAiAdapter } from './providers/gemini-openai.adapter';
import { OpenAiAdapter } from './providers/openai.adapter';
import { PROVIDER_ADAPTERS } from './providers/provider-adapter';
import { RelationalRecallPersistenceModule } from '../recalls/infrastructure/persistence/relational/relational-persistence.module';
import { RecallService } from '../recall/recall.service';
import { ProxyGcService } from './proxy-gc.service';
import { ProxyService } from './proxy.service';

const ADAPTERS = [
  OpenAiAdapter,
  GeminiOpenAiAdapter,
  AnthropicAdapter,
  GeminiNativeAdapter,
  CustomOpenAiAdapter,
];

@Module({
  imports: [
    ProjectsModule,
    ParsimApiKeysModule,
    UsageRecordsModule,
    ContextModule,
    CompressionModule,
    RequestSnapshotsModule,
    RelationalAgentSessionPersistenceModule,
    RelationalGcRunPersistenceModule,
    RelationalGcDecisionPersistenceModule,
    RelationalArchivedItemPersistenceModule,
    RelationalRecallPersistenceModule,
  ],
  controllers: [
    ChatCompletionsController,
    MessagesController,
    GeminiController,
  ],
  providers: [
    ...ADAPTERS,
    {
      // Add a provider by writing an adapter and listing it in ADAPTERS.
      provide: PROVIDER_ADAPTERS,
      useFactory: (...adapters: InstanceType<(typeof ADAPTERS)[number]>[]) =>
        adapters,
      inject: ADAPTERS,
    },
    ProxyService,
    ProxyGcService,
    RecallService,
  ],
  // Replay sends recorded requests through the same adapters and recall.
  exports: [PROVIDER_ADAPTERS, RecallService],
})
export class ProxyModule {}
