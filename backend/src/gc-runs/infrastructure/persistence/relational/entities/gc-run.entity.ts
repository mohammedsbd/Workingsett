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
  name: 'gc_run',
})
@Index(['projectId', 'createdAt'])
export class GcRunEntity extends EntityRelationalHelper {
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

  @Index()
  @Column({ type: 'uuid', nullable: true })
  agentSessionId: string | null;

  @ManyToOne(() => AgentSessionEntity, {
    eager: false,
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'agentSessionId' })
  agentSession?: AgentSessionEntity | null;

  @Column({ type: 'uuid', nullable: true })
  usageRecordId: string | null;

  @ManyToOne(() => UsageRecordEntity, {
    eager: false,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'usageRecordId' })
  usageRecord?: UsageRecordEntity | null;

  @Column({ type: 'varchar', length: 8 })
  mode: string;

  @Column({ type: 'boolean' })
  ran: boolean;

  @Column({ type: 'boolean' })
  applied: boolean;

  @Column({ type: 'boolean' })
  failed: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  error: string | null;

  @Column({ type: 'integer', nullable: true })
  tokensBefore: number | null;

  @Column({ type: 'integer', nullable: true })
  tokensAfter: number | null;

  @Column({ type: 'integer' })
  decisionCount: number;

  @Column({ type: 'integer' })
  newDecisionCount: number;

  @Column({ type: 'integer' })
  durationMs: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
