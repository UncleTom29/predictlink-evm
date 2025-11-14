import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventManagerModule } from './event-manager.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(EventManagerModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: configService.get('CORS_ORIGINS', '*').split(','),
    credentials: true,
  });

  const port = configService.get('PORT', 3001);
  await app.listen(port);

  logger.log(`Event Manager Service running on port ${port}`);
}

bootstrap();