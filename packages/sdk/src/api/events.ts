import { HttpClient } from '../http/client';
import { WebSocketClient } from '../websocket/client';
import { Event, CreateEventInput, EventFilter, PaginatedResponse, ConfidenceScore } from '../types';
import { validateCreateEventInput, validateEventId, validatePaginationParams } from '../validators';
import { ENDPOINTS, WEBSOCKET_CHANNELS } from '../constants';

export class EventsAPI {
  constructor(
    private httpClient: HttpClient,
    private wsClient: WebSocketClient
  ) {}

  async create(input: CreateEventInput): Promise<Event> {
    validateCreateEventInput(input);
    return this.httpClient.request<Event>('POST', ENDPOINTS.EVENTS, input);
  }

  async get(id: string): Promise<Event> {
    validateEventId(id);
    return this.httpClient.request<Event>('GET', `${ENDPOINTS.EVENTS}/${id}`);
  }

  async list(filter?: EventFilter): Promise<PaginatedResponse<Event>> {
    if (filter?.limit || filter?.offset) {
      validatePaginationParams(filter.limit, filter.offset);
    }

    const queryParams = this.buildQueryParams(filter);
    const endpoint = queryParams 
      ? `${ENDPOINTS.EVENTS}?${queryParams}` 
      : ENDPOINTS.EVENTS;

    return this.httpClient.request<PaginatedResponse<Event>>('GET', endpoint);
  }

  async update(id: string, updates: Partial<Event>): Promise<Event> {
    validateEventId(id);
    return this.httpClient.request<Event>(
      'PATCH',
      `${ENDPOINTS.EVENTS}/${id}`,
      updates
    );
  }

  async triggerDetection(id: string): Promise<{ success: boolean; message: string }> {
    validateEventId(id);
    return this.httpClient.request(
      'POST',
      `${ENDPOINTS.EVENTS}/${id}/detect`
    );
  }

  async getConfidence(id: string): Promise<ConfidenceScore> {
    validateEventId(id);
    return this.httpClient.request<ConfidenceScore>(
      'GET',
      `${ENDPOINTS.EVENTS}/${id}${ENDPOINTS.CONFIDENCE}`
    );
  }

  subscribeToUpdates(eventId: string, callback: (event: Event) => void): void {
    validateEventId(eventId);
    
    this.wsClient.subscribe(`${WEBSOCKET_CHANNELS.EVENTS}:${eventId}`);
    
    this.wsClient.on('event_status_changed', (data: any) => {
      if (data.eventId === eventId || data.id === eventId) {
        callback(data);
      }
    });
  }

  subscribeToAll(callback: (event: Event) => void): void {
    this.wsClient.subscribe(WEBSOCKET_CHANNELS.EVENTS);
    
    this.wsClient.on('event_status_changed', (data: any) => {
      callback(data);
    });
  }

  unsubscribe(eventId?: string): void {
    if (eventId) {
      validateEventId(eventId);
      this.wsClient.unsubscribe(`${WEBSOCKET_CHANNELS.EVENTS}:${eventId}`);
    } else {
      this.wsClient.unsubscribe(WEBSOCKET_CHANNELS.EVENTS);
    }
  }

  private buildQueryParams(filter?: EventFilter): string {
    if (!filter) return '';

    const params = new URLSearchParams();

    if (filter.status) params.append('status', filter.status);
    if (filter.category) params.append('category', filter.category);
    if (filter.fromDate) params.append('fromDate', filter.fromDate);
    if (filter.toDate) params.append('toDate', filter.toDate);
    if (filter.limit) params.append('limit', filter.limit.toString());
    if (filter.offset) params.append('offset', filter.offset.toString());

    return params.toString();
  }
}