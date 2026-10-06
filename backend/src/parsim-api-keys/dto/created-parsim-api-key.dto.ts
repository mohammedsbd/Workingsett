import { ApiProperty } from '@nestjs/swagger';
import { ParsimApiKey } from '../domain/parsim-api-key';

/** Returned once, at creation: the only time the full key is shown. */
export class CreatedParsimApiKeyDto extends ParsimApiKey {
  @ApiProperty({
    type: String,
    description: 'The full key. Store it now; it cannot be shown again.',
  })
  key: string;
}
