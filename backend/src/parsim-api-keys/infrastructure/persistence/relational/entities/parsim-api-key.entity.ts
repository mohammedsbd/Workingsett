import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectEntity } from '../../../../../projects/infrastructure/persistence/relational/entities/project.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'parsim_api_key',
})
export class ParsimApiKeyEntity extends EntityRelationalHelper {
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

  @Column({ nullable: true, type: String })
  name: string | null;

  @Column({ type: String })
  prefix: string;

  /** SHA-256 hex of the key. Requests are authenticated by this lookup. */
  @Index({ unique: true })
  @Column({ type: String })
  keyHash: string;

  @Column({ nullable: true, type: 'timestamptz' })
  lastUsedAt: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  revokedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
