import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { FinishedReplayStatus, Replay } from '../../../../domain/replay';
import { NewReplay, ReplayRepository } from '../../replay.repository';
import { ReplayEntity } from '../entities/replay.entity';
import { ReplayMapper } from '../mappers/replay.mapper';

@Injectable()
export class ReplayRelationalRepository implements ReplayRepository {
  constructor(
    @InjectRepository(ReplayEntity)
    private readonly repository: Repository<ReplayEntity>,
  ) {}

  async create(replay: NewReplay): Promise<Replay> {
    const entity = await this.repository.save(
      this.repository.create({ ...replay, status: 'queued', spentUsd: 0 }),
    );
    return ReplayMapper.toDomain(entity);
  }

  async findById(id: string): Promise<NullableType<Replay>> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? ReplayMapper.toDomain(entity) : null;
  }

  async findBySession(agentSessionId: string): Promise<Replay[]> {
    const entities = await this.repository.find({
      where: { agentSessionId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => ReplayMapper.toDomain(entity));
  }

  async start(id: string): Promise<boolean> {
    const result = await this.repository.update(
      { id, status: 'queued' },
      { status: 'running', startedAt: new Date() },
    );
    return Boolean(result.affected);
  }

  async progress(
    id: string,
    progress: Pick<Replay, 'pointsDone' | 'spentUsd'>,
  ): Promise<void> {
    await this.repository.update({ id }, progress);
  }

  async finish(
    id: string,
    status: FinishedReplayStatus,
    error: string | null,
  ): Promise<void> {
    await this.repository.update(
      { id },
      { status, error: error?.slice(0, 200) ?? null, finishedAt: new Date() },
    );
  }
}
