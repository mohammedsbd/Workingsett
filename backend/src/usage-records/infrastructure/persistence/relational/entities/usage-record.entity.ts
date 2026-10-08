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
import { ProjectEntity } from '../../../../../projects/infrastructure/persistence/relational/entities/project.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

/** numeric columns come back from pg as strings; convert them to numbers. */
const numericToNumber = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity({
  name: 'usage_record',
})
@Index(['projectId', 'createdAt'])
export class UsageRecordEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => ProjectEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'projectId' })
  project?: ProjectEntity;

  /** The agent session the request belongs to, if it could be stored. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  agentSessionId: string | null;

  @ManyToOne(() => AgentSessionEntity, {
    eager: false,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'agentSessionId' })
  agentSession?: AgentSessionEntity | null;

  @Column({ type: String })
  upstream: string;

  @Column({ type: String })
  model: string;

  @Column({ type: 'integer' })
  inputTokens: number;

  @Column({ type: 'integer' })
  outputTokens: number;

  @Column({ type: 'integer', nullable: true })
  cachedInputTokens: number | null;

  @Column({ type: 'integer', nullable: true })
  cacheWriteInputTokens: number | null;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 8,
    nullable: true,
    transformer: numericToNumber,
  })
  costUsd: number | null;

  @Column({ type: 'integer' })
  latencyMs: number;

  @Column({ type: 'integer' })
  status: number;

  @Column({ type: Boolean })
  streamed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
