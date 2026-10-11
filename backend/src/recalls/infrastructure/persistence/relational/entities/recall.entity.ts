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
  name: 'recall',
})
@Index(['projectId', 'createdAt'])
export class RecallEntity extends EntityRelationalHelper {
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

  @Column({ type: 'uuid', nullable: true })
  agentSessionId: string | null;

  @ManyToOne(() => AgentSessionEntity, {
    eager: false,
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'agentSessionId' })
  agentSession?: AgentSessionEntity | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  usageRecordId: string | null;

  @ManyToOne(() => UsageRecordEntity, {
    eager: false,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'usageRecordId' })
  usageRecord?: UsageRecordEntity | null;

  @Column({ type: 'varchar', length: 100 })
  archiveId: string;

  @Column({ type: 'boolean' })
  found: boolean;

  @Column({ type: 'boolean' })
  refused: boolean;

  @Column({ type: 'integer' })
  tokensRestored: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
