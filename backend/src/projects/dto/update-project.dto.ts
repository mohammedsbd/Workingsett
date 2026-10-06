import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['providerKey'] as const),
) {
  @ApiPropertyOptional({
    nullable: true,
    description: 'New provider key, or null to remove the stored key.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  providerKey?: string | null;
}
