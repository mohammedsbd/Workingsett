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
  name: 'archived_item',
})
@Index(['projectId', 'archiveId'], { unique: true })
export class ArchivedItemEntity extends EntityRelationalHelper {
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

  @Column({ type: 'varchar', length: 40 })
  archiveId: string;

  @Column({ type: 'varchar', length: 200 })
  toolName: string;

  @Column({ type: 'char', length: 64 })
  contentHash: string;

  @Column({ type: 'integer' })
  tokenCount: number;

  @Column({ type: 'jsonb' })
  content: Record<string, unknown>;

  @Column({ type: 'integer' })
  sizeBytes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
