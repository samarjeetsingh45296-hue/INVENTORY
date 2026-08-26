import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma/prisma.service';
import { validateEnv } from './config/configuration';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Fail fast and loudly on bad configuration, before anything connects.
  const env = validateEnv(process.env);

  const app = await NestFactory.create(AppModule, {
    logger: env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug'],
  });

  app.setGlobalPrefix(env.API_PREFIX);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  if (env.TRUST_PROXY) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
    exposedHeaders: ['x-request-id', 'Content-Disposition'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Inventory Suite API')
      .setDescription(
        'Asset and inventory management. The database is the permanent source ' +
          'of truth; Google Sheets are an import surface only.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(`${env.API_PREFIX}/docs`, app, SwaggerModule.createDocument(app, config));
  }

  app.enableShutdownHooks();
  app.get(PrismaService).enableShutdownHooks(app);

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.log(`API listening on http://localhost:${env.API_PORT}/${env.API_PREFIX}`);
  if (env.NODE_ENV !== 'production') {
    logger.log(`API docs at http://localhost:${env.API_PORT}/${env.API_PREFIX}/docs`);
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start:', err);
  process.exit(1);
});
