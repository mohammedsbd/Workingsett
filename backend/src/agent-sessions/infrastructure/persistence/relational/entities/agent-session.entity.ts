import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProjectEntity } from '../../../../../projects/infrastructure/persistence/relational/entities/project.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'agent_session',
})
@Index(['projectId', 'externalId'], { unique: true })
@Index(['projectId', 'lastSeenAt'])
export class AgentSessionEntity extends EntityRelationalHelper {
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

  @Column({ type: 'varchar', length: 200 })
  externalId: string;

  @Column({ type: 'varchar', length: 16 })
  idSource: string;

  @Column({ type: String })
  provider: string;

  @Column({ type: String })
  model: string;

  @Column({ type: 'timestamptz' })
  firstSeenAt: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @Column({ type: 'integer', default: 0 })
  requestCount: number;
}
