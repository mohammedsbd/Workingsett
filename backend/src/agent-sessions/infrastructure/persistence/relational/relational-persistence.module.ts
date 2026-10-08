import { Module } from '@nestjs/common';
import { AgentSessionRepository } from '../agent-session.repository';
import { AgentSessionRelationalRepository } from './repositories/agent-session.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentSessionEntity } from './entities/agent-session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AgentSessionEntity])],
  providers: [
    {
      provide: AgentSessionRepository,
      useClass: AgentSessionRelationalRepository,
    },
  ],
  exports: [AgentSessionRepository],
})
export class RelationalAgentSessionPersistenceModule {}
