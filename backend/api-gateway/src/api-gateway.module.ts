import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { EventsController } from './controllers/events.controller';
import { ProposalsController } from './controllers/proposals.controller';
import { DisputesController } from './controllers/disputes.controller';
import { HealthController } from './controllers/health.controller';
import { EventsService } from './services/events.service';
import { ProposalsService } from './services/proposals.service';
import { DisputesService } from './services/disputes.service';
import { HealthService } from './services/health.service';
import { CacheService } from './services/cache.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RateLimitGuard } from './guards/rate-limit.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        timeout: configService.get('HTTP_TIMEOUT', 30000),
        maxRedirects: 5,
      }),
      inject: [ConfigService],
    }),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: '24h',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    EventsController,
    ProposalsController,
    DisputesController,
    HealthController,
  ],
  providers: [
    EventsService,
    ProposalsService,
    DisputesService,
    HealthService,
    CacheService,
    JwtStrategy,
    RateLimitGuard,
  ],
})
export class ApiGatewayModule {}