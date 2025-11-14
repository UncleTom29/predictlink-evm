import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@nestjs/axios';
import { Event } from './entities/event.entity';
import { EventManagerService } from './services/event-manager.service';
import { EventClassificationService } from './services/event-classification.service';
import { EventProcessor } from './processors/event.processor';
import { EventController } from './controllers/event.controller';
import { WebhookController } from './controllers/webhook.controller';
import { BlockchainService } from './services/blockchain.service';
import { CacheService } from './services/cache.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DATABASE_HOST'),
        port: configService.get('DATABASE_PORT'),
        username: configService.get('DATABASE_USER'),
        password: configService.get('DATABASE_PASSWORD'),
        database: configService.get('DATABASE_NAME'),
        entities: [Event],
        synchronize: false,
        logging: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Event]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST'),
          port: configService.get('REDIS_PORT'),
          password: configService.get('REDIS_PASSWORD'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'event-processing',
    }),
    HttpModule,
  ],
  controllers: [EventController, WebhookController],
  providers: [
    EventManagerService,
    EventClassificationService,
    EventProcessor,
    BlockchainService,
    CacheService,
  ],
  exports: [EventManagerService],
})
export class EventManagerModule {}