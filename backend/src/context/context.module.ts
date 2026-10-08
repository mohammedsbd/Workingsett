import { Module } from '@nestjs/common';
import { RelationalAgentSessionPersistenceModule } from '../agent-sessions/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalContextContentPersistenceModule } from '../context-contents/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalContextItemPersistenceModule } from '../context-items/infrastructure/persistence/relational/relational-persistence.module';
import { ContextCaptureService } from './context-capture.service';

/** Agent sessions and context storage, used by the proxy after each request. */
@Module({
  imports: [
    RelationalAgentSessionPersistenceModule,
    RelationalContextItemPersistenceModule,
    RelationalContextContentPersistenceModule,
  ],
  providers: [ContextCaptureService],
  exports: [ContextCaptureService],
})
export class ContextModule {}
