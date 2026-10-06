import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NewUsageRecord, UsageRecord } from '../../../../domain/usage-record';
import { UsageRecordRepository } from '../../usage-record.repository';
import { UsageRecordEntity } from '../entities/usage-record.entity';
import { UsageRecordMapper } from '../mappers/usage-record.mapper';

@Injectable()
export class UsageRecordRelationalRepository implements UsageRecordRepository {
  constructor(
    @InjectRepository(UsageRecordEntity)
    private readonly repository: Repository<UsageRecordEntity>,
  ) {}

  async create(data: NewUsageRecord): Promise<UsageRecord> {
    const entity = await this.repository.save(this.repository.create(data));
    return UsageRecordMapper.toDomain(entity);
  }

  async findByProject(projectId: string): Promise<UsageRecord[]> {
    const entities = await this.repository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => UsageRecordMapper.toDomain(entity));
  }
}
