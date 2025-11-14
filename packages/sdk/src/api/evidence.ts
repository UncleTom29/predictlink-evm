import { HttpClient } from '../http/client';
import { Evidence } from '../types';
import { validateEventId } from '../validators';
import { ENDPOINTS } from '../constants';

export class EvidenceAPI {
  constructor(private httpClient: HttpClient) {}

  async get(eventId: string): Promise<Evidence> {
    validateEventId(eventId);
    return this.httpClient.request<Evidence>('GET', `${ENDPOINTS.EVIDENCE}/${eventId}`);
  }

  async getByProposal(proposalId: string): Promise<Evidence> {
    return this.httpClient.request<Evidence>(
      'GET',
      `${ENDPOINTS.EVIDENCE}/proposal/${proposalId}`
    );
  }

  async verify(eventId: string, evidenceHash: string): Promise<{
    valid: boolean;
    evidence: Evidence;
  }> {
    validateEventId(eventId);
    
    return this.httpClient.request(
      'POST',
      `${ENDPOINTS.EVIDENCE}/${eventId}/verify`,
      { evidenceHash }
    );
  }

  async getSources(eventId: string): Promise<{
    sources: Array<{
      type: string;
      url: string;
      credibility: number;
      timestamp: string;
    }>;
  }> {
    validateEventId(eventId);
    return this.httpClient.request(
      'GET',
      `${ENDPOINTS.EVIDENCE}/${eventId}/sources`
    );
  }
}