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
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { StartReplayDto } from './dto/start-replay.dto';
import { ReplayService } from './replay.service';
import {
  ReplayEstimateView,
  ReplayOptions,
  ReplayReport,
  ReplaySummary,
} from './replay.types';

type AuthedRequest = { user: JwtPayloadType };

/**
 * Replays of one agent session, for the session page. Only the project's
 * owner can use them; any other project or session id is a 404.
 */
@ApiTags('Replay')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@ApiParam({ name: 'projectId', type: String })
@ApiParam({ name: 'sessionId', type: String })
@Controller({
  path: 'projects/:projectId/sessions/:sessionId/replays',
  version: '1',
})
export class ReplayController {
  constructor(private readonly replay: ReplayService) {}

  /** What can be replayed, the defaults, and why not if it cannot. */
  @Get('options')
  options(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<ReplayOptions> {
    return this.replay.options(Number(req.user.id), projectId, sessionId);
  }

  /** The cost estimate shown before starting. Sends nothing upstream. */
  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  estimate(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: StartReplayDto,
  ): Promise<ReplayEstimateView> {
    return this.replay.estimate(Number(req.user.id), projectId, sessionId, dto);
  }

  /** Queues a replay; it runs in the background. */
  @Post()
  start(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: StartReplayDto,
  ): Promise<ReplaySummary> {
    return this.replay.start(Number(req.user.id), projectId, sessionId, dto);
  }

  @Get()
  list(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<ReplaySummary[]> {
    return this.replay.list(Number(req.user.id), projectId, sessionId);
  }

  /** Progress and the report: agreement, both versions' cost, the points. */
  @Get(':replayId')
  @ApiParam({ name: 'replayId', type: String })
  report(
    @Request() req: AuthedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('replayId', ParseUUIDPipe) replayId: string,
  ): Promise<ReplayReport> {
    return this.replay.report(
      Number(req.user.id),
      projectId,
      sessionId,
      replayId,
    );
  }
}
