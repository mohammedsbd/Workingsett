import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  NewSnapshotPart,
  SnapshotPartRepository,
} from '../../snapshot-part.repository';
import { SnapshotPartEntity } from '../entities/snapshot-part.entity';

/** Rows per statement, to stay well under Postgres' parameter limit. */
const BATCH = 200;

@Injectable()
export class SnapshotPartRelationalRepository implements SnapshotPartRepository {
  constructor(
    @InjectRepository(SnapshotPartEntity)
    private readonly repository: Repository<SnapshotPartEntity>,
  ) {}

  async insertMissing(parts: NewSnapshotPart[]): Promise<number> {
    // The same message can appear twice in one request; insert it once.
    const unique = [
      ...new Map(parts.map((p) => [`${p.projectId}:${p.hash}`, p])).values(),
    ];
    let inserted = 0;
    for (let i = 0; i < unique.length; i += BATCH) {
      const result = await this.repository
        .createQueryBuilder()
        .insert()
        .values(unique.slice(i, i + BATCH))
        .orIgnore()
        .returning(['id'])
        .execute();
      inserted += (result.raw as unknown[]).length;
    }
    return inserted;
  }

  async findJson(
    projectId: string,
    hashes: string[],
  ): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const unique = [...new Set(hashes)];
    for (let i = 0; i < unique.length; i += BATCH) {
      const rows = await this.repository.find({
        select: { hash: true, json: true },
        where: { projectId, hash: In(unique.slice(i, i + BATCH)) },
      });
      for (const row of rows) found.set(row.hash, row.json);
    }
    return found;
  }
}
