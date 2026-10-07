import {
  ClassSerializerInterceptor,
  NestApplicationOptions,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { useContainer } from 'class-validator';
import { raw } from 'express';
import { AppModule } from './app.module';
import { AllConfigType } from './config/config.type';
import { ResolvePromisesInterceptor } from './utils/serializer.interceptor';
import validationOptions from './utils/validation-options';

/** Body parsing is set up in configureApp, per route group. */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

/** Routes served outside the /api prefix for OpenAI-compatible clients. */
const PROXY_PATH = '/v1';

/**
 * Global setup shared by main.ts and the e2e tests, so tests run the app
 * exactly as production does.
 */
export function configureApp(app: NestExpressApplication): void {
  const configService = app.get(ConfigService<AllConfigType>);

  // The proxy gets the exact request bytes so it can forward them unchanged.
  app.use(
    PROXY_PATH,
    raw({
      type: () => true,
      limit: configService.getOrThrow('proxy.bodyLimit', { infer: true }),
    }),
  );
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });

  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  app.setGlobalPrefix(
    configService.getOrThrow('app.apiPrefix', { infer: true }),
    {
      exclude: [
        '/',
        { path: 'v1/chat/completions', method: RequestMethod.POST },
        { path: 'v1/messages', method: RequestMethod.POST },
        { path: 'v1/messages/count_tokens', method: RequestMethod.POST },
      ],
    },
  );
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new ValidationPipe(validationOptions));
  app.useGlobalInterceptors(
    // ResolvePromisesInterceptor is used to resolve promises in responses because class-transformer can't do it
    // https://github.com/typestack/class-transformer/issues/549
    new ResolvePromisesInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );
}
