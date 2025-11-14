import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { EventManagerService } from '../services/event-manager.service';
import { EventStatus } from '../entities/event.entity';

@Controller('events')
export class EventController {
  private readonly logger = new Logger(EventController.name);

  constructor(private readonly eventManagerService: EventManagerService) {}

  @Get()
  async listEvents(
    @Query('status') status?: EventStatus,
    @Query('category') category?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.eventManagerService.listEvents({
      status,
      category,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit: limit ? parseInt(limit.toString()) : 50,
      offset: offset ? parseInt(offset.toString()) : 0,
    });
  }

  @Get(':id')
  async getEvent(@Param('id') id: string) {
    const event = await this.eventManagerService.getEvent(id);
    if (!event) {
      throw new Error(`Event ${id} not found`);
    }
    return event;
  }

  @Post(':id/detect')
  async triggerDetection(@Param('id') id: string) {
    this.logger.log(`Triggering detection for event: ${id}`);
    
    const event = await this.eventManagerService.getEvent(id);
    if (!event) {
      throw new Error(`Event ${id} not found`);
    }

    return {
      success: true,
      message: 'Detection triggered',
      eventId: id,
    };
  }

  @Get(':id/confidence')
  async getConfidenceScore(@Param('id') id: string) {
    const event = await this.eventManagerService.getEvent(id);
    if (!event) {
      throw new Error(`Event ${id} not found`);
    }

    return {
      eventId: id,
      confidenceScore: event.confidenceScore,
      status: event.status,
      metadata: event.metadata,
    };
  }
}

