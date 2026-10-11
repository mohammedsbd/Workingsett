import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { DashboardService } from './dashboard.service';
import {
  DailySavings,
  Paged,
  ProjectSettings,
  SavingsSummary,
  SessionDetail,
  SessionRow,
} from './dashboard.types';
import { DateRangeQueryDto, SessionsQueryDto } from './dto/dashboard-query.dto';

type AuthedRequest = { user: JwtPayloadType };

/**
 * Read-only data for the dashboard, per project. Only the project's owner
 * can read it; any other project id is a 404.
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@ApiParam({ name: 'projectId', type: String })
@Controller({ path: 'projects/:projectId', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/summary')
  summary(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: DateRangeQueryDto,
  ): Promise<SavingsSummary> {
    return this.dashboard.summary(Number(req.user.id), projectId, query);
  }

  @Get('dashboard/daily')
  daily(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: DateRangeQueryDto,
  ): Promise<DailySavings[]> {
    return this.dashboard.daily(Number(req.user.id), projectId, query);
  }

  @Get('sessions')
  sessions(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: SessionsQueryDto,
  ): Promise<Paged<SessionRow>> {
    return this.dashboard.sessions(Number(req.user.id), projectId, query);
  }

  @Get('sessions/:sessionId')
  @ApiParam({ name: 'sessionId', type: String })
  session(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<SessionDetail> {
    return this.dashboard.session(Number(req.user.id), projectId, sessionId);
  }

  @Get('settings')
  settings(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSettings> {
    return this.dashboard.settings(Number(req.user.id), projectId);
  }
}
