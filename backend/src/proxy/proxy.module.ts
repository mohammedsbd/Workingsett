import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { ParsimApiKeysModule } from '../parsim-api-keys/parsim-api-keys.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsageRecordsModule } from '../usage-records/usage-records.module';
import { ChatCompletionsController } from './chat-completions.controller';
import { MessagesController } from './messages.controller';
import { AnthropicAdapter } from './providers/anthropic.adapter';
import { GeminiOpenAiAdapter } from './providers/gemini-openai.adapter';
import { OpenAiAdapter } from './providers/openai.adapter';
import { PROVIDER_ADAPTERS } from './providers/provider-adapter';
import { ProxyService } from './proxy.service';

const ADAPTERS = [OpenAiAdapter, GeminiOpenAiAdapter, AnthropicAdapter];

@Module({
  imports: [
    ProjectsModule,
    ParsimApiKeysModule,
    UsageRecordsModule,
    ContextModule,
  ],
  controllers: [ChatCompletionsController, MessagesController],
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
  ],
})
export class ProxyModule {}
