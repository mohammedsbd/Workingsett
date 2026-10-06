import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { ParsimApiKey } from './domain/parsim-api-key';
import { CreateParsimApiKeyDto } from './dto/create-parsim-api-key.dto';
import { CreatedParsimApiKeyDto } from './dto/created-parsim-api-key.dto';
import { ParsimApiKeyRepository } from './infrastructure/persistence/parsim-api-key.repository';
import {
  generateParsimKey,
  hashParsimKey,
  isWellFormedParsimKey,
} from './parsim-key';

@Injectable()
export class ParsimApiKeysService {
  constructor(
    private readonly keyRepository: ParsimApiKeyRepository,
    private readonly projectsService: ProjectsService,
  ) {}

  async create(
    ownerId: number,
    projectId: string,
    dto: CreateParsimApiKeyDto,
  ): Promise<CreatedParsimApiKeyDto> {
    await this.projectsService.findOwned(ownerId, projectId);
    const { key, prefix, hash } = generateParsimKey();
    const saved = await this.keyRepository.create({
      projectId,
      name: dto.name ?? null,
      prefix,
      keyHash: hash,
    });
    return Object.assign(new CreatedParsimApiKeyDto(), saved, { key });
  }

  async list(ownerId: number, projectId: string): Promise<ParsimApiKey[]> {
    await this.projectsService.findOwned(ownerId, projectId);
    return this.keyRepository.findByProject(projectId);
  }

  async revoke(
    ownerId: number,
    projectId: string,
    keyId: string,
  ): Promise<ParsimApiKey> {
    await this.projectsService.findOwned(ownerId, projectId);
    const key = await this.keyRepository.findById(keyId);
    if (!key || key.projectId !== projectId) throw new NotFoundException();
    const revoked = await this.keyRepository.revoke(keyId, new Date());
    if (!revoked) throw new NotFoundException();
    return revoked;
  }

  /**
   * The active key matching a presented token, or null. Also records when
   * the key was last used.
   */
  async verify(token: string): Promise<ParsimApiKey | null> {
    if (!isWellFormedParsimKey(token)) return null;
    const key = await this.keyRepository.findByHash(hashParsimKey(token));
    if (!key || key.revokedAt) return null;
    await this.keyRepository.markUsed(key.id, new Date());
    return key;
  }
}
