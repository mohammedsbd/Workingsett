import { Controller, Post, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PROXY_OPERATIONS } from './providers/provider-adapter';
import { ProxyService } from './proxy.service';

/**
 * OpenAI-compatible endpoint at /v1/chat/completions, outside the /api
 * prefix, so OpenAI SDKs work with baseURL "https://<host>/v1". The service
 * writes the response itself to stream it unchanged.
 */
@ApiExcludeController()
@Controller({ path: 'v1/chat/completions', version: VERSION_NEUTRAL })
export class ChatCompletionsController {
  constructor(private readonly proxyService: ProxyService) {}

  @Post()
  chatCompletions(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxyService.handle(PROXY_OPERATIONS.chatCompletions, req, res);
  }
}
