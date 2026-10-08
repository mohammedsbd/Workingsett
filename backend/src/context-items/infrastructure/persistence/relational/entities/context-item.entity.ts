import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AgentSessionEntity } from '../../../../../agent-sessions/infrastructure/persistence/relational/entities/agent-session.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'context_item',
})
@Index(['agentSessionId', 'position', 'contentHash'], { unique: true })
export class ContextItemEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  agentSessionId: string;

  @ManyToOne(() => AgentSessionEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'agentSessionId' })
  agentSession?: AgentSessionEntity;

  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'varchar', length: 16 })
  role: string;

  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  toolCallId: string | null;

  @Index()
  @Column({ type: 'char', length: 64 })
  contentHash: string;

  @Column({ type: 'integer' })
  tokenCount: number;

  @Column({ type: 'varchar', length: 40 })
  tokenizer: string;

  @Column({ type: 'integer' })
  firstSeenRequest: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
