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
