import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { CacheService } from './cache.service';

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);
  private readonly disputeServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    this.disputeServiceUrl = this.configService.get('DISPUTE_SERVICE_URL');
  }

  async fileDispute(createDisputeDto: any) {
    try {
      this.logger.log(`Filing dispute against proposal: ${createDisputeDto.proposalId}`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.disputeServiceUrl}/disputes`, createDisputeDto),
      );

      await this.cacheService.delete(`disputes:proposal:${createDisputeDto.proposalId}`);

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to file dispute: ${error.message}`, error.stack);
      throw error;
    }
  }

  async listDisputes(query: any) {
    try {
      const cacheKey = `disputes:list:${JSON.stringify(query)}`;
      
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        this.logger.debug('Returning cached dispute list');
        return JSON.parse(cached);
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.disputeServiceUrl}/disputes`, {
          params: query,
        }),
      );

      await this.cacheService.set(cacheKey, JSON.stringify(response.data), 30);

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to list disputes: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getDispute(id: string) {
    try {
      const cacheKey = `dispute:${id}`;
      const cached = await this.cacheService.get(cacheKey);
      
      if (cached) {
        this.logger.debug(`Cache hit for dispute ${id}`);
        return JSON.parse(cached);
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.disputeServiceUrl}/disputes/${id}`),
      );

      await this.cacheService.set(cacheKey, JSON.stringify(response.data), 300);

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get dispute ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async resolveDispute(id: string, body: any) {
    try {
      this.logger.log(`Resolving dispute ${id}`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.disputeServiceUrl}/disputes/${id}/resolve`, body),
      );

      await this.cacheService.delete(`dispute:${id}`);

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to resolve dispute ${id}: ${error.message}`);
      throw error;
    }
  }
}