import { HttpClient } from '../http/client';
import { WebSocketClient } from '../websocket/client';
import { Dispute, CreateDisputeInput, PaginatedResponse } from '../types';
import { validateCreateDisputeInput, validateDisputeId, validatePaginationParams } from '../validators';
import { ENDPOINTS, WEBSOCKET_CHANNELS } from '../constants';

export class DisputesAPI {
  constructor(
    private httpClient: HttpClient,
    private wsClient: WebSocketClient
  ) {}

  async file(input: CreateDisputeInput): Promise<Dispute> {
    validateCreateDisputeInput(input);
    return this.httpClient.request<Dispute>('POST', ENDPOINTS.DISPUTES, input);
  }

  async get(id: string): Promise<Dispute> {
    validateDisputeId(id);
    return this.httpClient.request<Dispute>('GET', `${ENDPOINTS.DISPUTES}/${id}`);
  }

  async list(filter?: {
    proposalId?: string;
    disputerAddress?: string;
    outcome?: 'upheld' | 'rejected' | 'pending';
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Dispute>> {
    if (filter?.limit || filter?.offset) {
      validatePaginationParams(filter.limit, filter.offset);
    }

    const queryParams = this.buildQueryParams(filter);
    const endpoint = queryParams 
      ? `${ENDPOINTS.DISPUTES}?${queryParams}` 
      : ENDPOINTS.DISPUTES;

    return this.httpClient.request<PaginatedResponse<Dispute>>('GET', endpoint);
  }

  async resolve(id: string, outcome: 'upheld' | 'rejected'): Promise<Dispute> {
    validateDisputeId(id);
    
    if (!['upheld', 'rejected'].includes(outcome)) {
      throw new Error('Outcome must be either "upheld" or "rejected"');
    }

    return this.httpClient.request<Dispute>(
      'POST',
      `${ENDPOINTS.DISPUTES}/${id}/resolve`,
      { outcome }
    );
  }

  subscribeToDisputes(proposalId: string, callback: (dispute: Dispute) => void): void {
    this.wsClient.subscribe(`${WEBSOCKET_CHANNELS.DISPUTES}:${proposalId}`);
    
    this.wsClient.on('dispute_filed', (data: any) => {
      if (data.proposalId === proposalId) {
        callback(data);
      }
    });
  }

  subscribeToResolution(disputeId: string, callback: (dispute: Dispute) => void): void {
    validateDisputeId(disputeId);
    
    this.wsClient.subscribe(`${WEBSOCKET_CHANNELS.DISPUTES}:${disputeId}`);
    
    this.wsClient.on('dispute_resolved', (data: any) => {
      if (data.disputeId === disputeId || data.id === disputeId) {
        callback(data);
      }
    });
  }

  unsubscribe(identifier?: string): void {
    if (identifier) {
      this.wsClient.unsubscribe(`${WEBSOCKET_CHANNELS.DISPUTES}:${identifier}`);
    } else {
      this.wsClient.unsubscribe(WEBSOCKET_CHANNELS.DISPUTES);
    }
  }

  private buildQueryParams(filter?: {
    proposalId?: string;
    disputerAddress?: string;
    outcome?: string;
    limit?: number;
    offset?: number;
  }): string {
    if (!filter) return '';

    const params = new URLSearchParams();

    if (filter.proposalId) params.append('proposalId', filter.proposalId);
    if (filter.disputerAddress) params.append('disputerAddress', filter.disputerAddress);
    if (filter.outcome) params.append('outcome', filter.outcome);
    if (filter.limit) params.append('limit', filter.limit.toString());
    if (filter.offset) params.append('offset', filter.offset.toString());

    return params.toString();
  }
}