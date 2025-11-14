import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { CacheService } from './cache.service';

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);
  private readonly proposalServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    this.proposalServiceUrl = this.configService.get('PROPOSAL_SERVICE_URL');
  }

  async submitProposal(createProposalDto: any) {
    try {
      this.logger.log(`Submitting proposal for event: ${createProposalDto.eventId}`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.proposalServiceUrl}/proposals`, createProposalDto),
      );

      await this.cacheService.delete(`proposals:event:${createProposalDto.eventId}`);

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to submit proposal: ${error.message}`, error.stack);
      throw error;
    }
  }

  async listProposals(filterDto: any) {
    try {
      const cacheKey = `proposals:list:${JSON.stringify(filterDto)}`;
      
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        this.logger.debug('Returning cached proposal list');
        return JSON.parse(cached);
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.proposalServiceUrl}/proposals`, {
          params: filterDto,
        }),
      );

      await this.cacheService.set(cacheKey, JSON.stringify(response.data), 30);

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to list proposals: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getProposal(id: string) {
    try {
      const cacheKey = `proposal:${id}`;
      const cached = await this.cacheService.get(cacheKey);
      
      if (cached) {
        this.logger.debug(`Cache hit for proposal ${id}`);
        return JSON.parse(cached);
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.proposalServiceUrl}/proposals/${id}`),
      );

      if (!response.data) {
        throw new NotFoundException(`Proposal ${id} not found`);
      }

      await this.cacheService.set(cacheKey, JSON.stringify(response.data), 300);

      return response.data;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to get proposal ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async finalizeProposal(id: string) {
    try {
      this.logger.log(`Finalizing proposal ${id}`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.proposalServiceUrl}/proposals/${id}/finalize`),
      );

      await this.cacheService.delete(`proposal:${id}`);

      return {
        success: true,
        message: 'Proposal finalized successfully',
        data: response.data,
      };
    } catch (error) {
      this.logger.error(`Failed to finalize proposal ${id}: ${error.message}`);
      throw error;
    }
  }
}