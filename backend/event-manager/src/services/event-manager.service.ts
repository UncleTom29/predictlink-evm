// src/event-manager/event-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event, EventStatus } from '../entities/event.entity';
import { EventClassificationService } from './event-classification.service';
import { BlockchainService } from '../services/blockchain.service';
import { CacheService } from '../services/cache.service';

interface EventDetection {
  eventId: string;
  description: string;
  category: string;
  sources: Array<{
    type: string;
    url: string;
    data: any;
    timestamp: number;
  }>;
  metadata: Record<string, any>;
}

interface QueuedEvent {
  eventId: string;
  priority: number;
  timestamp: number;
  data: EventDetection;
}

@Injectable()
export class EventManagerService {
  private readonly logger = new Logger(EventManagerService.name);
  private readonly DEDUPLICATION_WINDOW = 300000; // 5 minutes

  constructor(
    @InjectRepository(Event)
    private eventRepository: Repository<Event>,
    @InjectQueue('event-processing')
    private eventQueue: Queue<QueuedEvent>,
    private classificationService: EventClassificationService,
    private blockchainService: BlockchainService,
    private cacheService: CacheService,
  ) {}

  /**
   * Main entry point for event detection
   */
  async handleEventDetection(detection: EventDetection): Promise<string> {
    try {
      this.logger.log(`Processing event detection: ${detection.eventId}`);

      // Step 1: Deduplication check
      const isDuplicate = await this.checkDuplication(detection);
      if (isDuplicate) {
        this.logger.warn(`Duplicate event detected: ${detection.eventId}`);
        return detection.eventId;
      }

      // Step 2: Validate event data
      await this.validateEventData(detection);

      // Step 3: Classify event
      const classification = await this.classificationService.classify(
        detection.description,
        detection.sources,
      );

      // Step 4: Create event record
      const event = await this.createEvent(detection, classification);

      // Step 5: Calculate priority
      const priority = this.calculatePriority(event, classification);

      // Step 6: Queue for processing
      await this.queueEvent(event, priority);

      // Step 7: Cache event data
      await this.cacheEventData(event);

      this.logger.log(`Event queued successfully: ${event.id}`);
      return event.id;
    } catch (error) {
      this.logger.error(`Failed to handle event detection: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Check if event is a duplicate within time window
   */
  private async checkDuplication(detection: EventDetection): Promise<boolean> {
    const cacheKey = `event:dedup:${detection.eventId}`;
    const cached = await this.cacheService.get(cacheKey);

    if (cached) {
      return true;
    }

    // Check database for recent similar events
    const recentEvents = await this.eventRepository
      .createQueryBuilder('event')
      .where('event.created_at > :threshold', {
        threshold: new Date(Date.now() - this.DEDUPLICATION_WINDOW),
      })
      .andWhere('event.description ILIKE :desc', {
        desc: `%${detection.description.substring(0, 50)}%`,
      })
      .getMany();

    if (recentEvents.length > 0) {
      // Cache the deduplication result
      await this.cacheService.set(cacheKey, '1', this.DEDUPLICATION_WINDOW / 1000);
      return true;
    }

    // Mark as seen
    await this.cacheService.set(cacheKey, '1', this.DEDUPLICATION_WINDOW / 1000);
    return false;
  }

  /**
   * Validate event data structure and content
   */
  private async validateEventData(detection: EventDetection): Promise<void> {
    if (!detection.eventId || detection.eventId.length < 10) {
      throw new Error('Invalid event ID');
    }

    if (!detection.description || detection.description.length < 10) {
      throw new Error('Invalid event description');
    }

    if (!detection.sources || detection.sources.length === 0) {
      throw new Error('No sources provided');
    }

    // Validate each source
    for (const source of detection.sources) {
      if (!source.type || !source.url || !source.data) {
        throw new Error(`Invalid source data: ${JSON.stringify(source)}`);
      }
    }
  }

  /**
   * Create event record in database
   */
  private async createEvent(
    detection: EventDetection,
    classification: any,
  ): Promise<Event> {
    const event = this.eventRepository.create({
      eventId: detection.eventId,
      description: detection.description,
      category: classification.primaryCategory,
      subcategory: classification.subcategory,
      status: EventStatus.CREATED,
      metadata: {
        ...detection.metadata,
        classification: classification,
        sourceCount: detection.sources.length,
      },
      createdAt: new Date(),
    });

    return await this.eventRepository.save(event);
  }

  /**
   * Calculate processing priority (0-10, higher = more urgent)
   */
  private calculatePriority(event: Event, classification: any): number {
    let priority = 5; // Base priority

    // High-value markets get higher priority
    if (event.metadata.estimatedTVL > 1000000) {
      priority += 3;
    } else if (event.metadata.estimatedTVL > 100000) {
      priority += 2;
    }

    // Time-sensitive events
    if (classification.timeSensitivity === 'high') {
      priority += 2;
    }

    // Clear-cut events get higher priority
    if (classification.confidence > 0.95) {
      priority += 1;
    }

    return Math.min(10, priority);
  }

  /**
   * Queue event for AI processing
   */
  private async queueEvent(event: Event, priority: number): Promise<void> {
    await this.eventQueue.add(
      'process-event',
      {
        eventId: event.id,
        priority,
        timestamp: Date.now(),
        data: event,
      },
      {
        priority,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  /**
   * Cache event data for fast retrieval
   */
  private async cacheEventData(event: Event): Promise<void> {
    const cacheKey = `event:${event.id}`;
    await this.cacheService.set(cacheKey, JSON.stringify(event), 300); // 5 min TTL
  }

  /**
   * Update event status
   */
  async updateEventStatus(
    eventId: string,
    status: EventStatus,
    additionalData?: Record<string, any>,
  ): Promise<void> {
    await this.eventRepository.update(
      { id: eventId },
      {
        status,
        ...(additionalData && { metadata: () => `metadata || '${JSON.stringify(additionalData)}'::jsonb` }),
        updatedAt: new Date(),
      },
    );

    // Invalidate cache
    await this.cacheService.delete(`event:${eventId}`);

    // Emit event to blockchain if status change is significant
    if ([EventStatus.PROPOSED, EventStatus.DISPUTED, EventStatus.RESOLVED].includes(status)) {
      await this.blockchainService.emitEventStatusChange(eventId, status);
    }
  }

  /**
   * Get event by ID with caching
   */
  async getEvent(eventId: string): Promise<Event | null> {
    // Try cache first
    const cacheKey = `event:${eventId}`;
    const cached = await this.cacheService.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    // Fetch from database
    const event = await this.eventRepository.findOne({ where: { id: eventId } });

    if (event) {
      await this.cacheService.set(cacheKey, JSON.stringify(event), 300);
    }

    return event;
  }

  /**
   * List events with filtering and pagination
   */
  async listEvents(filters: {
    status?: EventStatus;
    category?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ events: Event[]; total: number }> {
    const query = this.eventRepository.createQueryBuilder('event');

    if (filters.status) {
      query.andWhere('event.status = :status', { status: filters.status });
    }

    if (filters.category) {
      query.andWhere('event.category = :category', { category: filters.category });
    }

    if (filters.fromDate) {
      query.andWhere('event.created_at >= :fromDate', { fromDate: filters.fromDate });
    }

    if (filters.toDate) {
      query.andWhere('event.created_at <= :toDate', { toDate: filters.toDate });
    }

    query.orderBy('event.created_at', 'DESC');
    query.take(filters.limit || 50);
    query.skip(filters.offset || 0);

    const [events, total] = await query.getManyAndCount();

    return { events, total };
  }

  /**
   * Handle webhook from external data sources
   */
  async handleWebhook(source: string, payload: any): Promise<void> {
    this.logger.log(`Received webhook from ${source}`);

    try {
      // Parse webhook payload based on source
      const detection = await this.parseWebhookPayload(source, payload);

      // Process the event
      await this.handleEventDetection(detection);
    } catch (error) {
      this.logger.error(`Failed to process webhook from ${source}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse webhook payload into EventDetection format
   */
  private async parseWebhookPayload(source: string, payload: any): Promise<EventDetection> {
    // Implement source-specific parsing logic
    switch (source) {
      case 'ap_news':
        return this.parseAPNewsPayload(payload);
      case 'reuters':
        return this.parseReutersPayload(payload);
      case 'sports_api':
        return this.parseSportsAPIPayload(payload);
      default:
        throw new Error(`Unknown webhook source: ${source}`);
    }
  }

  private parseAPNewsPayload(payload: any): EventDetection {
    return {
      eventId: `ap_${payload.id}`,
      description: payload.headline,
      category: 'news',
      sources: [
        {
          type: 'ap_news',
          url: payload.url,
          data: payload,
          timestamp: new Date(payload.published).getTime(),
        },
      ],
      metadata: {
        originalSource: 'ap_news',
        credibility: 0.95,
      },
    };
  }

  private parseReutersPayload(payload: any): EventDetection {
    return {
      eventId: `reuters_${payload.guid}`,
      description: payload.title,
      category: 'news',
      sources: [
        {
          type: 'reuters',
          url: payload.link,
          data: payload,
          timestamp: new Date(payload.pubDate).getTime(),
        },
      ],
      metadata: {
        originalSource: 'reuters',
        credibility: 0.95,
      },
    };
  }

  private parseSportsAPIPayload(payload: any): EventDetection {
    return {
      eventId: `sports_${payload.eventId}`,
      description: `${payload.homeTeam} vs ${payload.awayTeam} - ${payload.status}`,
      category: 'sports',
      sources: [
        {
          type: 'sports_api',
          url: payload.apiUrl,
          data: payload,
          timestamp: Date.now(),
        },
      ],
      metadata: {
        originalSource: 'sports_api',
        sport: payload.sport,
        league: payload.league,
        credibility: 0.90,
      },
    };
  }
}


