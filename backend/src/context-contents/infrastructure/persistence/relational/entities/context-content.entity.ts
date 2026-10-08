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
  name: 'context_content',
})
@Index(['projectId', 'hash'], { unique: true })
export class ContextContentEntity extends EntityRelationalHelper {
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

  @Column({ type: 'jsonb' })
  content: Record<string, unknown>;

  @Column({ type: 'integer' })
  sizeBytes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
