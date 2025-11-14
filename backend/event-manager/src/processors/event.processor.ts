import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event, EventStatus } from '../entities/event.entity';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface QueuedEvent {
  eventId: string;
  priority: number;
  timestamp: number;
  data: any;
}

@Processor('event-processing')
export class EventProcessor {
  private readonly logger = new Logger(EventProcessor.name);

  constructor(
    @InjectRepository(Event)
    private eventRepository: Repository<Event>,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  @Process('process-event')
  async handleEventProcessing(job: Job<QueuedEvent>) {
    this.logger.log(`Processing event job: ${job.data.eventId}`);

    try {
      const event = await this.eventRepository.findOne({
        where: { id: job.data.eventId },
      });

      if (!event) {
        this.logger.error(`Event not found: ${job.data.eventId}`);
        return;
      }

      await this.updateEventStatus(event, EventStatus.DETECTING);

      const mlAnalysis = await this.performMLAnalysis(event);

      if (mlAnalysis.recommendation === 'auto_propose') {
        await this.updateEventStatus(event, EventStatus.PROPOSING);
        await this.submitProposal(event, mlAnalysis);
      } else if (mlAnalysis.recommendation === 'human_review') {
        await this.updateEventStatus(event, EventStatus.EVIDENCE_GATHERING);
        await this.notifyHumanReview(event, mlAnalysis);
      } else {
        await this.updateEventStatus(event, EventStatus.CREATED);
        this.logger.warn(`Insufficient data for event: ${event.id}`);
      }

      this.logger.log(`Event processing completed: ${event.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to process event ${job.data.eventId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async performMLAnalysis(event: Event): Promise<any> {
    try {
      const mlServiceUrl = this.configService.get('AI_SERVICE_URL');
      
      const response = await firstValueFrom(
        this.httpService.post(`${mlServiceUrl}/analyze`, {
          event_id: event.id,
          description: event.description,
          category: event.category,
          metadata: event.metadata,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`ML analysis failed: ${error.message}`);
      throw error;
    }
  }

  private async submitProposal(event: Event, mlAnalysis: any): Promise<void> {
    try {
      const proposalServiceUrl = this.configService.get('PROPOSAL_SERVICE_URL');

      await firstValueFrom(
        this.httpService.post(`${proposalServiceUrl}/proposals`, {
          eventId: event.eventId,
          outcomeData: mlAnalysis.predicted_outcome,
          outcomeHash: mlAnalysis.outcome_hash,
          confidenceScore: Math.floor(mlAnalysis.confidence_score * 10000),
          evidenceUri: mlAnalysis.evidence_uri,
          bondAmount: this.configService.get('MIN_PROPOSER_BOND'),
        }),
      );

      await this.updateEventStatus(event, EventStatus.LIVENESS);
    } catch (error) {
      this.logger.error(`Proposal submission failed: ${error.message}`);
      throw error;
    }
  }

  private async notifyHumanReview(event: Event, mlAnalysis: any): Promise<void> {
    try {
      const notificationServiceUrl = this.configService.get('NOTIFICATION_SERVICE_URL');

      await firstValueFrom(
        this.httpService.post(`${notificationServiceUrl}/notify`, {
          type: 'human_review_required',
          eventId: event.id,
          reason: mlAnalysis.recommendation_reason,
          confidence: mlAnalysis.confidence_score,
        }),
      );
    } catch (error) {
      this.logger.error(`Notification failed: ${error.message}`);
    }
  }

  private async updateEventStatus(
    event: Event,
    status: EventStatus,
  ): Promise<void> {
    event.status = status;
    event.updatedAt = new Date();
    await this.eventRepository.save(event);
  }

  @Process('batch-process-events')
  async handleBatchProcessing(job: Job<{ eventIds: string[] }>) {
    this.logger.log(`Batch processing ${job.data.eventIds.length} events`);

    const results = await Promise.allSettled(
      job.data.eventIds.map((eventId) =>
        this.handleEventProcessing({
          data: { eventId, priority: 5, timestamp: Date.now(), data: {} },
        } as Job<QueuedEvent>),
      ),
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    this.logger.log(
      `Batch processing complete: ${successful} successful, ${failed} failed`,
    );
  }
}