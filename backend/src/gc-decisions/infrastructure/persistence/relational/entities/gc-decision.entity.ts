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
import { GcRunEntity } from '../../../../../gc-runs/infrastructure/persistence/relational/entities/gc-run.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'gc_decision',
})
@Index(['agentSessionId', 'itemKey'], { unique: true })
export class GcDecisionEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  gcRunId: string;

  @ManyToOne(() => GcRunEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'gcRunId' })
  gcRun?: GcRunEntity;

  @Column({ type: 'uuid' })
  agentSessionId: string;

  @ManyToOne(() => AgentSessionEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'agentSessionId' })
  agentSession?: AgentSessionEntity;

  @Column({ type: 'varchar', length: 300 })
  itemKey: string;

  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  toolCallId: string | null;

  @Column({ type: 'varchar', length: 200 })
  toolName: string;

  @Column({ type: 'char', length: 64 })
  contentHash: string;

  @Column({ type: 'varchar', length: 16 })
  decision: string;

  @Column({ type: 'varchar', length: 32 })
  reason: string;

  @Column({ type: 'varchar', length: 300 })
  detail: string;

  @Column({ type: 'integer' })
  tokensBefore: number;

  @Column({ type: 'integer' })
  tokensAfter: number;

  @Column({ type: 'text' })
  replacement: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  archiveId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
