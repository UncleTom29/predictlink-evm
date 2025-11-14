import { Controller, Post, Body, Headers, Logger } from '@nestjs/common';
import { EventManagerService } from '../services/event-manager.service';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly eventManagerService: EventManagerService) {}

  @Post('ap-news')
  async handleAPNews(@Body() payload: any, @Headers('x-api-key') apiKey: string) {
    this.logger.log('Received webhook from AP News');
    
    try {
      await this.eventManagerService.handleWebhook('ap_news', payload);
      return { success: true, message: 'Webhook processed' };
    } catch (error) {
      this.logger.error(`Failed to process AP News webhook: ${error.message}`);
      throw error;
    }
  }

  @Post('reuters')
  async handleReuters(@Body() payload: any, @Headers('x-api-key') apiKey: string) {
    this.logger.log('Received webhook from Reuters');
    
    try {
      await this.eventManagerService.handleWebhook('reuters', payload);
      return { success: true, message: 'Webhook processed' };
    } catch (error) {
      this.logger.error(`Failed to process Reuters webhook: ${error.message}`);
      throw error;
    }
  }

  @Post('sports')
  async handleSportsAPI(@Body() payload: any, @Headers('x-api-key') apiKey: string) {
    this.logger.log('Received webhook from Sports API');
    
    try {
      await this.eventManagerService.handleWebhook('sports_api', payload);
      return { success: true, message: 'Webhook processed' };
    } catch (error) {
      this.logger.error(`Failed to process Sports API webhook: ${error.message}`);
      throw error;
    }
  }

  @Post('blockchain')
  async handleBlockchainEvent(@Body() payload: any) {
    this.logger.log('Received blockchain event webhook');
    
    try {
      await this.eventManagerService.handleWebhook('blockchain', payload);
      return { success: true, message: 'Blockchain event processed' };
    } catch (error) {
      this.logger.error(`Failed to process blockchain event: ${error.message}`);
      throw error;
    }
  }
}