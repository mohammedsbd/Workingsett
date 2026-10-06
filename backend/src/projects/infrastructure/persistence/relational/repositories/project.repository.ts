import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Project } from '../../../../domain/project';
import {
  NewProject,
  ProjectChanges,
  ProjectRepository,
} from '../../project.repository';
import { ProjectEntity } from '../entities/project.entity';
import { ProjectMapper } from '../mappers/project.mapper';

@Injectable()
export class ProjectRelationalRepository implements ProjectRepository {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
  ) {}

  async create(data: NewProject): Promise<Project> {
    const entity = await this.projectRepository.save(
      this.projectRepository.create(data),
    );
    return ProjectMapper.toDomain(entity);
  }

  async findByOwner(ownerId: Project['ownerId']): Promise<Project[]> {
    const entities = await this.projectRepository.find({
      where: { ownerId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => ProjectMapper.toDomain(entity));
  }

  async findById(id: Project['id']): Promise<NullableType<Project>> {
    const entity = await this.projectRepository.findOne({ where: { id } });
    return entity ? ProjectMapper.toDomain(entity) : null;
  }

  async findOldest(): Promise<NullableType<Project>> {
    const [entity] = await this.projectRepository.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    return entity ? ProjectMapper.toDomain(entity) : null;
  }

  async update(
    id: Project['id'],
    changes: ProjectChanges,
  ): Promise<NullableType<Project>> {
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(defined).length) {
      await this.projectRepository.update({ id }, defined);
    }
    return this.findById(id);
  }
}
