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
  name: 'request_snapshot',
})
@Index(['agentSessionId', 'requestNumber'], { unique: true })
export class RequestSnapshotEntity extends EntityRelationalHelper {
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

  @Column({ type: 'integer' })
  requestNumber: number;

  @Column({ type: 'uuid', nullable: true })
  usageRecordId: string | null;

  @ManyToOne(() => UsageRecordEntity, {
    eager: false,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'usageRecordId' })
  usageRecord?: UsageRecordEntity | null;

  @Column({ type: 'varchar', length: 32 })
  api: string;

  @Column({ type: 'varchar', length: 255 })
  model: string;

  @Column({ type: 'boolean' })
  streamed: boolean;

  @Column({ type: 'jsonb' })
  original: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  gc: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
