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
import { UsageRecordEntity } from '../../../../../usage-records/infrastructure/persistence/relational/entities/usage-record.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'compression',
})
@Index(['agentSessionId', 'stretchKey'], { unique: true })
export class CompressionEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => ProjectEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'projectId' })
  project?: ProjectEntity;

  @Column({ type: 'uuid' })
  agentSessionId: string;

  @ManyToOne(() => AgentSessionEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'agentSessionId' })
  agentSession?: AgentSessionEntity;

  @Column({ type: 'char', length: 64 })
  stretchKey: string;

  @Column({ type: 'integer' })
  startIndex: number;

  @Column({ type: 'integer' })
  endIndex: number;

  @Column({ type: 'integer' })
  firstTurn: number;

  @Column({ type: 'integer' })
  lastTurn: number;

  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  input: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  stateBlock: string | null;

  @Column({ type: 'integer' })
  tokensBefore: number;

  @Column({ type: 'integer', nullable: true })
  tokensAfter: number | null;

  @Column({ type: 'uuid', nullable: true })
  usageRecordId: string | null;

  @ManyToOne(() => UsageRecordEntity, {
    eager: false,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'usageRecordId' })
  usageRecord?: UsageRecordEntity | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  readyAt: Date | null;
}
