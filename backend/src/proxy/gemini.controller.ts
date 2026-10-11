import {
  Controller,
  Param,
  Post,
  Req,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { proxyErrors } from './proxy-error';
import { PROXY_OPERATIONS, ProxyOperation } from './providers/provider-adapter';
import { ProxyService } from './proxy.service';

const OPERATIONS: Record<string, ProxyOperation> = {
  generateContent: PROXY_OPERATIONS.generateContent,
  streamGenerateContent: PROXY_OPERATIONS.streamGenerateContent,
  countTokens: PROXY_OPERATIONS.geminiCountTokens,
};

/**
 * Gemini native API at /v1beta/models/{model}:{method}, outside the /api
 * prefix and with Google's paths, so the Google GenAI SDK works with its
 * base URL set to "https://<host>". The model and method share one path
 * segment, split at the last colon.
 */
@ApiExcludeController()
@Controller({ path: 'v1beta/models', version: VERSION_NEUTRAL })
export class GeminiController {
  constructor(private readonly proxyService: ProxyService) {}

  @Post(':modelMethod')
  async call(
    @Param('modelMethod') modelMethod: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const colon = modelMethod.lastIndexOf(':');
    const model = colon > 0 ? modelMethod.slice(0, colon) : '';
    const operation = OPERATIONS[modelMethod.slice(colon + 1)];
    if (!model || colon === -1 || !operation) {
      const error = proxyErrors.unknownGeminiMethod();
      res.status(error.status).json(error.toBody('gemini-native'));
      return;
    }
    await this.proxyService.handle(operation, req, res, model);
  }
}
