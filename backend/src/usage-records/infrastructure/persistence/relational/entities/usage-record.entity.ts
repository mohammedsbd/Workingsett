import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
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
