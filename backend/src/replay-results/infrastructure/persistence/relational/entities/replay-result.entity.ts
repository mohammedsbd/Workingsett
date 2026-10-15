import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ReplayEntity } from '../../../../../replays/infrastructure/persistence/relational/entities/replay.entity';
import { numericToNumber } from '../../../../../utils/numeric-transformer';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'replay_result',
})
@Index(['replayId', 'requestNumber'], { unique: true })
export class ReplayResultEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  replayId: string;

  @ManyToOne(() => ReplayEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'replayId' })
  replay?: ReplayEntity;

  @Column({ type: 'integer' })
  requestNumber: number;

  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Column({ type: 'boolean' })
  gcChanged: boolean;

  @Column({ type: 'jsonb', nullable: true })
  original: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  gc: Record<string, unknown> | null;

  @Column({ type: 'boolean', nullable: true })
  exactMatch: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  toolCallsMatch: boolean | null;

  @Column({ type: 'smallint', nullable: true })
  judgeScore: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  judgeReason: string | null;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 8,
    default: 0,
    transformer: numericToNumber,
  })
  judgeCostUsd: number;

  @Column({ type: 'boolean', nullable: true })
  agreed: boolean | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
