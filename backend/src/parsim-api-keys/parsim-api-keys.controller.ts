import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { ParsimApiKey } from './domain/parsim-api-key';
import { CreateParsimApiKeyDto } from './dto/create-parsim-api-key.dto';
import { CreatedParsimApiKeyDto } from './dto/created-parsim-api-key.dto';
import { ParsimApiKeysService } from './parsim-api-keys.service';

type AuthedRequest = { user: JwtPayloadType };

@ApiTags('Parsim API keys')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@ApiParam({ name: 'projectId', type: String })
@Controller({
  path: 'projects/:projectId/api-keys',
  version: '1',
})
export class ParsimApiKeysController {
  constructor(private readonly keysService: ParsimApiKeysService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CreatedParsimApiKeyDto })
  create(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateParsimApiKeyDto,
  ) {
    return this.keysService.create(Number(req.user.id), projectId, dto);
  }

  @Get()
  @ApiOkResponse({ type: ParsimApiKey, isArray: true })
  list(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.keysService.list(Number(req.user.id), projectId);
  }

  @Post(':keyId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'keyId', type: String })
  @ApiOkResponse({ type: ParsimApiKey })
  revoke(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ) {
    return this.keysService.revoke(Number(req.user.id), projectId, keyId);
  }
}
