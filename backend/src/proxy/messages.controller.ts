import { Controller, Post, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PROXY_OPERATIONS } from './providers/provider-adapter';
import { ProxyService } from './proxy.service';

/**
 * Anthropic Messages API at /v1/messages, outside the /api prefix, so
 * Anthropic SDKs and tools work with ANTHROPIC_BASE_URL="https://<host>".
 */
@ApiExcludeController()
@Controller({ path: 'v1/messages', version: VERSION_NEUTRAL })
export class MessagesController {
  constructor(private readonly proxyService: ProxyService) {}

  @Post()
  messages(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxyService.handle(PROXY_OPERATIONS.messages, req, res);
  }

  /** Passed through to Anthropic; not recorded as usage. */
  @Post('count_tokens')
  countTokens(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxyService.handle(PROXY_OPERATIONS.countTokens, req, res);
  }
}
