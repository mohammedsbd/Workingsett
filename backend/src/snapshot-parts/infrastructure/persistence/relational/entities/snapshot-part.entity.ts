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

@Entity({
  name: 'snapshot_part',
})
@Index(['projectId', 'hash'], { unique: true })
export class SnapshotPartEntity extends EntityRelationalHelper {
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

  @Column({ type: 'char', length: 64 })
  hash: string;

  /** Text, not jsonb: jsonb would reorder keys. */
  @Column({ type: 'text' })
  json: string;

  @Column({ type: 'integer' })
  sizeBytes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
