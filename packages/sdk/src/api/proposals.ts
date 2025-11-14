import { HttpClient } from '../http/client';
import { WebSocketClient } from '../websocket/client';
import { Proposal, CreateProposalInput, PaginatedResponse } from '../types';
import { validateCreateProposalInput, validateProposalId, validatePaginationParams } from '../validators';
import { ENDPOINTS, WEBSOCKET_CHANNELS } from '../constants';

export class ProposalsAPI {
  constructor(
    private httpClient: HttpClient,
    private wsClient: WebSocketClient
  ) {}

  async submit(input: CreateProposalInput): Promise<Proposal> {
    validateCreateProposalInput(input);
    return this.httpClient.request<Proposal>('POST', ENDPOINTS.PROPOSALS, input);
  }

  async get(id: string): Promise<Proposal> {
    validateProposalId(id);
    return this.httpClient.request<Proposal>('GET', `${ENDPOINTS.PROPOSALS}/${id}`);
  }

  async list(filter?: {
    eventId?: string;
    proposerAddress?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Proposal>> {
    if (filter?.limit || filter?.offset) {
      validatePaginationParams(filter.limit, filter.offset);
    }

    const queryParams = this.buildQueryParams(filter);
    const endpoint = queryParams 
      ? `${ENDPOINTS.PROPOSALS}?${queryParams}` 
      : ENDPOINTS.PROPOSALS;

    return this.httpClient.request<PaginatedResponse<Proposal>>('GET', endpoint);
  }

  async finalize(id: string): Promise<Proposal> {
    validateProposalId(id);
    return this.httpClient.request<Proposal>(
      'POST',
      `${ENDPOINTS.PROPOSALS}/${id}/finalize`
    );
  }

  subscribeToNew(marketId: string, callback: (proposal: Proposal) => void): void {
    this.wsClient.subscribe(`${WEBSOCKET_CHANNELS.PROPOSALS}:${marketId}`);
    
    this.wsClient.on('new_proposal', (data: any) => {
      if (data.eventId === marketId) {
        callback(data);
      }
    });
  }

  subscribeToProposal(proposalId: string, callback: (proposal: Proposal) => void): void {
    validateProposalId(proposalId);
    
    this.wsClient.subscribe(`${WEBSOCKET_CHANNELS.PROPOSALS}:${proposalId}`);
    
    this.wsClient.on('proposal_updated', (data: any) => {
      if (data.proposalId === proposalId || data.id === proposalId) {
        callback(data);
      }
    });
  }

  unsubscribe(identifier?: string): void {
    if (identifier) {
      this.wsClient.unsubscribe(`${WEBSOCKET_CHANNELS.PROPOSALS}:${identifier}`);
    } else {
      this.wsClient.unsubscribe(WEBSOCKET_CHANNELS.PROPOSALS);
    }
  }

  private buildQueryParams(filter?: {
    eventId?: string;
    proposerAddress?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): string {
    if (!filter) return '';

    const params = new URLSearchParams();

    if (filter.eventId) params.append('eventId', filter.eventId);
    if (filter.proposerAddress) params.append('proposerAddress', filter.proposerAddress);
    if (filter.status) params.append('status', filter.status);
    if (filter.limit) params.append('limit', filter.limit.toString());
    if (filter.offset) params.append('offset', filter.offset.toString());

    return params.toString();
  }
}