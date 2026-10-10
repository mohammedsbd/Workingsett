import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GcRun } from '../../../../domain/gc-run';
import { GcRunRepository, NewGcRun } from '../../gc-run.repository';
import { GcRunEntity } from '../entities/gc-run.entity';
import { GcRunMapper } from '../mappers/gc-run.mapper';

@Injectable()
export class GcRunRelationalRepository implements GcRunRepository {
  constructor(
    @InjectRepository(GcRunEntity)
    private readonly repository: Repository<GcRunEntity>,
  ) {}

  async create(run: NewGcRun): Promise<GcRun> {
    const entity = await this.repository.save(this.repository.create(run));
    return GcRunMapper.toDomain(entity);
  }

  async findByProject(projectId: string): Promise<GcRun[]> {
    const entities = await this.repository.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => GcRunMapper.toDomain(entity));
  }
}
