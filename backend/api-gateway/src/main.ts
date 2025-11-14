// api-gateway/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';
import { ApiGatewayModule } from './api-gateway.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { RateLimitGuard } from './guards/rate-limit.guard';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(ApiGatewayModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  // Security
  app.use(helmet());
  app.enableCors({
    origin: configService.get('CORS_ORIGINS', '*').split(','),
    credentials: true,
  });

  // Compression
  app.use(compression());

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PredictLink API')
    .setDescription('AI-Powered Oracle for Instant Market Resolution on BNB Chain')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('events', 'Event management endpoints')
    .addTag('proposals', 'Proposal endpoints')
    .addTag('disputes', 'Dispute management')
    .addTag('evidence', 'Evidence retrieval')
    .addTag('health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get('PORT', 3000);
  await app.listen(port);

  logger.log(`API Gateway running on port ${port}`);
  logger.log(`Swagger documentation available at http://localhost:${port}/docs`);
}

bootstrap();

// src/api-gateway/controllers/events.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { EventsService } from '../services/events.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { CreateEventDto } from '../dto/create-event.dto';
import { UpdateEventDto } from '../dto/update-event.dto';
import { EventFilterDto } from '../dto/event-filter.dto';
import { EventResponseDto } from '../dto/event-response.dto';

@ApiTags('events')
@Controller('events')
@UseGuards(RateLimitGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new event' })
  @ApiResponse({ status: 201, description: 'Event created successfully', type: EventResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async createEvent(@Body() createEventDto: CreateEventDto): Promise<EventResponseDto> {
    return this.eventsService.createEvent(createEventDto);
  }

  @Get()
  @ApiOperation({ summary: 'List events with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Events retrieved successfully' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async listEvents(@Query() filterDto: EventFilterDto) {
    return this.eventsService.listEvents(filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event by ID' })
  @ApiResponse({ status: 200, description: 'Event retrieved successfully', type: EventResponseDto })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async getEvent(@Param('id') id: string): Promise<EventResponseDto> {
    return this.eventsService.getEvent(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update event status or metadata' })
  @ApiResponse({ status: 200, description: 'Event updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async updateEvent(
    @Param('id') id: string,
    @Body() updateEventDto: UpdateEventDto,
  ): Promise<EventResponseDto> {
    return this.eventsService.updateEvent(id, updateEventDto);
  }

  @Post(':id/detect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger event detection and processing' })
  @ApiResponse({ status: 202, description: 'Event detection triggered' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async triggerDetection(@Param('id') id: string) {
    return this.eventsService.triggerDetection(id);
  }

  @Get(':id/confidence')
  @ApiOperation({ summary: 'Get confidence score for event' })
  @ApiResponse({ status: 200, description: 'Confidence score retrieved' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async getConfidenceScore(@Param('id') id: string) {
    return this.eventsService.getConfidenceScore(id);
  }
}

// src/api-gateway/controllers/proposals.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ProposalsService } from '../services/proposals.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { CreateProposalDto } from '../dto/create-proposal.dto';
import { ProposalFilterDto } from '../dto/proposal-filter.dto';

@ApiTags('proposals')
@Controller('proposals')
@UseGuards(RateLimitGuard)
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a proposal for event resolution' })
  @ApiResponse({ status: 201, description: 'Proposal submitted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async submitProposal(@Body() createProposalDto: CreateProposalDto) {
    return this.proposalsService.submitProposal(createProposalDto);
  }

  @Get()
  @ApiOperation({ summary: 'List proposals with filtering' })
  @ApiResponse({ status: 200, description: 'Proposals retrieved successfully' })
  async listProposals(@Query() filterDto: ProposalFilterDto) {
    return this.proposalsService.listProposals(filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get proposal by ID' })
  @ApiResponse({ status: 200, description: 'Proposal retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Proposal not found' })
  async getProposal(@Param('id') id: string) {
    return this.proposalsService.getProposal(id);
  }

  @Post(':id/finalize')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalize a proposal after liveness period' })
  @ApiResponse({ status: 200, description: 'Proposal finalized' })
  @ApiResponse({ status: 400, description: 'Cannot finalize - conditions not met' })
  async finalizeProposal(@Param('id') id: string) {
    return this.proposalsService.finalizeProposal(id);
  }
}

// src/api-gateway/controllers/disputes.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DisputesService } from '../services/disputes.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { CreateDisputeDto } from '../dto/create-dispute.dto';

@ApiTags('disputes')
@Controller('disputes')
@UseGuards(RateLimitGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'File a dispute against a proposal' })
  @ApiResponse({ status: 201, description: 'Dispute filed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or dispute conditions not met' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async fileDispute(@Body() createDisputeDto: CreateDisputeDto) {
    return this.disputesService.fileDispute(createDisputeDto);
  }

  @Get()
  @ApiOperation({ summary: 'List disputes' })
  @ApiResponse({ status: 200, description: 'Disputes retrieved successfully' })
  async listDisputes(@Query() query: any) {
    return this.disputesService.listDisputes(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dispute by ID' })
  @ApiResponse({ status: 200, description: 'Dispute retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Dispute not found' })
  async getDispute(@Param('id') id: string) {
    return this.disputesService.getDispute(id);
  }

  @Post(':id/resolve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a dispute (admin/arbitrator only)' })
  @ApiResponse({ status: 200, description: 'Dispute resolved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  async resolveDispute(@Param('id') id: string, @Body() body: any) {
    return this.disputesService.resolveDispute(id, body);
  }
}

// src/api-gateway/services/events.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { CreateEventDto } from '../dto/create-event.dto';
import { UpdateEventDto } from '../dto/update-event.dto';
import { EventFilterDto } from '../dto/event-filter.dto';
import { EventResponseDto } from '../dto/event-response.dto';
import { CacheService } from '../../data-layer/cache/cache.service';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly eventManagerUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    this.eventManagerUrl = this.configService.get('EVENT_MANAGER_URL');
  }

  async createEvent(createEventDto: CreateEventDto): Promise<EventResponseDto> {
    try {
      this.logger.log(`Creating event: ${createEventDto.description}`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.eventManagerUrl}/events`, createEventDto),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to create event: ${error.message}`, error.stack);
      throw error;
    }
  }

  async listEvents(filterDto: EventFilterDto) {
    try {
      // Build cache key
      const cacheKey = `events:list:${JSON.stringify(filterDto)}`;
      
      // Try cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        this.logger.debug('Returning cached event list');
        return JSON.parse(cached);
      }

      // Fetch from Event Manager
      const response = await firstValueFrom(
        this.httpService.get(`${this.eventManagerUrl}/events`, {
          params: filterDto,
        }),
      );

      // Cache for 30 seconds
      await this.cacheService.set(cacheKey, JSON.stringify(response.data), 30);

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to list events: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getEvent(id: string): Promise<EventResponseDto> {
    try {
      // Try cache first
      const cacheKey = `event:${id}`;
      const cached = await this.cacheService.get(cacheKey);
      
      if (cached) {
        this.logger.debug(`Cache hit for event ${id}`);
        return JSON.parse(cached);
      }

      // Fetch from Event Manager
      const response = await firstValueFrom(
        this.httpService.get(`${this.eventManagerUrl}/events/${id}`),
      );

      if (!response.data) {
        throw new NotFoundException(`Event ${id} not found`);
      }

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, JSON.stringify(response.data), 300);

      return response.data;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to get event ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateEvent(id: string, updateEventDto: UpdateEventDto): Promise<EventResponseDto> {
    try {
      this.logger.log(`Updating event ${id}`);

      const response = await firstValueFrom(
        this.httpService.patch(`${this.eventManagerUrl}/events/${id}`, updateEventDto),
      );

      // Invalidate cache
      await this.cacheService.delete(`event:${id}`);

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to update event ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async triggerDetection(id: string) {
    try {
      this.logger.log(`Triggering detection for event ${id}`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.eventManagerUrl}/events/${id}/detect`),
      );

      return {
        success: true,
        message: 'Event detection triggered',
        data: response.data,
      };
    } catch (error) {
      this.logger.error(`Failed to trigger detection for ${id}: ${error.message}`);
      throw error;
    }
  }

  async getConfidenceScore(id: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.eventManagerUrl}/events/${id}/confidence`),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get confidence score for ${id}: ${error.message}`);
      throw error;
    }
  }
}

// src/api-gateway/dto/create-event.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsObject, IsDateString } from 'class-validator';

export class CreateEventDto {
  @ApiProperty({ description: 'Event description', example: 'Super Bowl 2025 Winner' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Event category', example: 'sports' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ 
    description: 'Expected resolution time', 
    example: '2025-02-09T23:00:00Z',
    required: false 
  })
  @IsDateString()
  @IsOptional()
  resolutionTime?: string;

  @ApiProperty({ description: 'Additional metadata', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

// src/api-gateway/guards/rate-limit.guard.ts
import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { CacheService } from '../../data-layer/cache/cache.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windowSize: number;
  private readonly maxRequests: number;

  constructor(
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {
    this.windowSize = this.configService.get('RATE_LIMIT_WINDOW', 3600); // 1 hour
    this.maxRequests = this.configService.get('RATE_LIMIT_MAX_REQUESTS', 1000);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const identifier = this.getIdentifier(request);

    const key = `ratelimit:${identifier}`;
    const current = await this.cacheService.get(key);

    if (!current) {
      // First request in window
      await this.cacheService.set(key, '1', this.windowSize);
      return true;
    }

    const count = parseInt(current, 10);

    if (count >= this.maxRequests) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          retryAfter: await this.cacheService.ttl(key),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Increment counter
    await this.cacheService.incr(key);
    return true;
  }

  private getIdentifier(request: any): string {
    // Use API key if present, otherwise use IP address
    const apiKey = request.headers['x-api-key'];
    if (apiKey) {
      return `api:${apiKey}`;
    }

    const ip = request.ip || request.connection.remoteAddress;
    return `ip:${ip}`;
  }
}

// src/api-gateway/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid or missing authentication token');
    }
    return user;
  }
}

// src/api-gateway/filters/http-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: typeof message === 'string' ? message : (message as any).message || message,
    };

    this.logger.error(
      `${request.method} ${request.url}`,
      JSON.stringify(errorResponse),
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json(errorResponse);
  }
}

// src/api-gateway/interceptors/logging.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '';
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          const { statusCode } = response;
          const duration = Date.now() - startTime;

          this.logger.log(
            `${method} ${url} ${statusCode} ${duration}ms - ${ip} - ${userAgent}`,
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `${method} ${url} ${error.status || 500} ${duration}ms - ${ip} - ${userAgent}`,
            error.stack,
          );
        },
      }),
    );
  }
}