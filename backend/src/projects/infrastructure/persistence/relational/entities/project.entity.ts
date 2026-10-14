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
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'project',
})
export class ProjectEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: String })
  name: string;

  /** "openai" or "gemini"; validated in the DTOs. */
  @Column({ type: String })
  upstream: string;

  @Index()
  @Column({ type: Number })
  ownerId: number;

  @ManyToOne(() => UserEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ownerId' })
  owner?: UserEntity;

  @Column({ nullable: true, type: String })
  providerKeyEncrypted?: string | null;

  /** Store context content; null means the PARSIM_STORE_CONTENT default. */
  @Column({ nullable: true, type: Boolean })
  storeContent?: boolean | null;

  /** off, shadow or on. */
  @Column({ type: 'varchar', length: 8, default: 'shadow' })
  gcMode: string;

  @Column({ type: 'integer', nullable: true })
  gcMinContextTokens?: number | null;

  @Column({ type: 'integer', nullable: true })
  gcBatchTokens?: number | null;

  @Column({ type: 'integer', nullable: true })
  gcProtectedTurns?: number | null;

  @Column({ type: 'integer', nullable: true })
  gcArchiveMinTokens?: number | null;

  @Column({ type: 'integer', nullable: true })
  gcArchiveAfterTurns?: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  gcSideEffectTools: string[];

  @Column({ type: 'boolean', default: false })
  compressionEnabled: boolean;

  @Column({ type: 'varchar', length: 8, default: 'parsim' })
  compressionKeySource: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  compressionModel?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
