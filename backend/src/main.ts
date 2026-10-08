import 'dotenv/config';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { APP_OPTIONS, configureApp } from './app-setup';
import { AllConfigType } from './config/config.type';
import { OBSERVE_ENABLED, ObserveInstrument } from './observe';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...APP_OPTIONS,
    ...(OBSERVE_ENABLED && { instrument: ObserveInstrument }),
  });
  configureApp(app);
  const configService = app.get(ConfigService<AllConfigType>);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const corsOrigins = configService.getOrThrow('app.corsOrigins', {
    infer: true,
  });
  app.enableCors({
    origin: corsOrigins.includes('*') ? '*' : corsOrigins,
  });

  app.enableShutdownHooks();

  const options = new DocumentBuilder()
    .setTitle('API')
    .setDescription('API docs')
    .setVersion('1.0')
    .addBearerAuth()
    .addGlobalParameters({
      in: 'header',
      required: false,
      name: process.env.APP_HEADER_LANGUAGE || 'x-custom-lang',
      schema: {
        example: 'en',
      },
    })
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document);

  await app.listen(configService.getOrThrow('app.port', { infer: true }));
}
void bootstrap();
