import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { Project } from './domain/project';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

type AuthedRequest = { user: JwtPayloadType };

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'projects',
  version: '1',
})
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiCreatedResponse({ type: Project })
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req: AuthedRequest, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(Number(req.user.id), dto);
  }

  @Get()
  @ApiOkResponse({ type: Project, isArray: true })
  findAll(@Request() req: AuthedRequest) {
    return this.projectsService.findForOwner(Number(req.user.id));
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: Project })
  findOne(
    @Request() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projectsService.findOwned(Number(req.user.id), id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: Project })
  update(
    @Request() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(Number(req.user.id), id, dto);
  }
}
