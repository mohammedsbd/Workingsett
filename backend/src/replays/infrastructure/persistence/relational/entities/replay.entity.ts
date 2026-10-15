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
import { numericToNumber } from '../../../../../utils/numeric-transformer';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

const usd = {
  type: 'numeric',
  precision: 18,
  scale: 8,
  transformer: numericToNumber,
} as const;

@Entity({
  name: 'replay',
})
export class ReplayEntity extends EntityRelationalHelper {
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

  @Index()
  @Column({ type: 'uuid' })
  agentSessionId: string;

  @ManyToOne(() => AgentSessionEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'agentSessionId' })
  agentSession?: AgentSessionEntity;

  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Column({ type: 'jsonb' })
  requestNumbers: number[];

  @Column(usd)
  budgetUsd: number;

  @Column(usd)
  estimatedCostUsd: number;

  @Column({ ...usd, default: 0 })
  spentUsd: number;

  @Column({ type: 'varchar', length: 8 })
  judgeKeySource: string;

  @Column({ type: 'varchar', length: 16 })
  judgeProvider: string;

  @Column({ type: 'varchar', length: 100 })
  judgeModel: string;

  @Column({ type: 'integer', default: 0 })
  pointsDone: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
