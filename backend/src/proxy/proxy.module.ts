import { Module } from '@nestjs/common';
import { ParsimApiKeysModule } from '../parsim-api-keys/parsim-api-keys.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsageRecordsModule } from '../usage-records/usage-records.module';
import { CHAT_COMPLETIONS_ADAPTERS } from './providers/chat-completions-adapter';
import { GeminiOpenAiAdapter } from './providers/gemini-openai.adapter';
import { OpenAiAdapter } from './providers/openai.adapter';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';

@Module({
  imports: [ProjectsModule, ParsimApiKeysModule, UsageRecordsModule],
  controllers: [ProxyController],
  providers: [
    OpenAiAdapter,
    GeminiOpenAiAdapter,
    {
      // Add a provider by writing an adapter and listing it here.
      provide: CHAT_COMPLETIONS_ADAPTERS,
      useFactory: (...adapters: [OpenAiAdapter, GeminiOpenAiAdapter]) =>
        adapters,
      inject: [OpenAiAdapter, GeminiOpenAiAdapter],
    },
    ProxyService,
  ],
})
export class ProxyModule {}
