import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { NullableType } from '../utils/types/nullable.type';
import { Project } from './domain/project';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectRepository } from './infrastructure/persistence/project.repository';
import { ProviderKeyCipher } from './provider-key-cipher';

@Injectable()
export class ProjectsService {
  private cipher?: ProviderKeyCipher;

  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  create(ownerId: number, dto: CreateProjectDto): Promise<Project> {
    return this.projectRepository.create({
      name: dto.name,
      upstream: dto.upstream,
      ownerId,
      storeContent: dto.storeContent ?? null,
      gcMode: dto.gcMode ?? 'shadow',
      gcMinContextTokens: dto.gcMinContextTokens ?? null,
      gcBatchTokens: dto.gcBatchTokens ?? null,
      gcProtectedTurns: dto.gcProtectedTurns ?? null,
      gcArchiveMinTokens: dto.gcArchiveMinTokens ?? null,
      gcArchiveAfterTurns: dto.gcArchiveAfterTurns ?? null,
      gcSideEffectTools: dto.gcSideEffectTools ?? [],
      compressionEnabled: dto.compressionEnabled ?? false,
      compressionKeySource: dto.compressionKeySource ?? 'parsim',
      compressionModel: dto.compressionModel ?? null,
      replayJudgeKeySource: dto.replayJudgeKeySource ?? 'parsim',
      replayJudgeModel: dto.replayJudgeModel ?? null,
      providerKeyEncrypted: dto.providerKey
        ? this.getCipher().encrypt(dto.providerKey)
        : null,
    });
  }

  findForOwner(ownerId: number): Promise<Project[]> {
    return this.projectRepository.findByOwner(ownerId);
  }

  /** The project if it exists and belongs to the user, else 404. */
  async findOwned(ownerId: number, id: Project['id']): Promise<Project> {
    const project = await this.projectRepository.findById(id);
    if (!project || project.ownerId !== ownerId) {
      throw new NotFoundException();
    }
    return project;
  }

  async update(
    ownerId: number,
    id: Project['id'],
    dto: UpdateProjectDto,
  ): Promise<Project> {
    await this.findOwned(ownerId, id);
    const updated = await this.projectRepository.update(id, {
      name: dto.name,
      upstream: dto.upstream,
      storeContent: dto.storeContent,
      gcMode: dto.gcMode,
      gcMinContextTokens: dto.gcMinContextTokens,
      gcBatchTokens: dto.gcBatchTokens,
      gcProtectedTurns: dto.gcProtectedTurns,
      gcArchiveMinTokens: dto.gcArchiveMinTokens,
      gcArchiveAfterTurns: dto.gcArchiveAfterTurns,
      gcSideEffectTools: dto.gcSideEffectTools,
      compressionEnabled: dto.compressionEnabled,
      compressionKeySource: dto.compressionKeySource,
      compressionModel: dto.compressionModel,
      replayJudgeKeySource: dto.replayJudgeKeySource,
      replayJudgeModel: dto.replayJudgeModel,
      ...(dto.providerKey !== undefined && {
        providerKeyEncrypted: dto.providerKey
          ? this.getCipher().encrypt(dto.providerKey)
          : null,
      }),
    });
    if (!updated) throw new NotFoundException();
    return updated;
  }

  findById(id: Project['id']): Promise<NullableType<Project>> {
    return this.projectRepository.findById(id);
  }

  findOldest(): Promise<NullableType<Project>> {
    return this.projectRepository.findOldest();
  }

  /** Decrypted stored provider key, or undefined if none is stored. */
  /** Whether the project stores content (its setting, or PARSIM_STORE_CONTENT). */
  storesContent(project: Project): boolean {
    return (
      project.storeContent ??
      this.configService.getOrThrow('proxy.storeContentDefault', {
        infer: true,
      })
    );
  }

  storedProviderKey(project: Project): string | undefined {
    return project.providerKeyEncrypted
      ? this.getCipher().decrypt(project.providerKeyEncrypted)
      : undefined;
  }

  private getCipher(): ProviderKeyCipher {
    this.cipher ??= new ProviderKeyCipher(
      this.configService.get('proxy.encryptionKey', { infer: true }),
    );
    return this.cipher;
  }
}
