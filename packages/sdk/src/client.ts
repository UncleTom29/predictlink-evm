import { EventEmitter } from 'events';
import { PredictLinkConfig } from './types';
import { validateConfig } from './validators';
import { HttpClient } from './http/client';
import { WebSocketClient } from './websocket/client';
import { EventsAPI } from './api/events';
import { ProposalsAPI } from './api/proposals';
import { DisputesAPI } from './api/disputes';
import { EvidenceAPI } from './api/evidence';
import { DEFAULT_CONFIG } from './constants';

export class PredictLinkClient extends EventEmitter {
  private config: PredictLinkConfig;
  private httpClient: HttpClient;
  private wsClient: WebSocketClient;

  public events: EventsAPI;
  public proposals: ProposalsAPI;
  public disputes: DisputesAPI;
  public evidence: EvidenceAPI;

  constructor(config: PredictLinkConfig) {
    super();
    
    validateConfig(config);
    
    this.config = {
      ...config,
      apiUrl: config.apiUrl || DEFAULT_CONFIG.apiUrl,
      wsUrl: config.wsUrl || config.apiUrl?.replace('http', 'ws'),
      timeout: config.timeout || DEFAULT_CONFIG.timeout,
      retries: config.retries || DEFAULT_CONFIG.retries,
    };

    this.httpClient = new HttpClient(this.config);
    this.wsClient = new WebSocketClient(this.config);

    this.events = new EventsAPI(this.httpClient, this.wsClient);
    this.proposals = new ProposalsAPI(this.httpClient, this.wsClient);
    this.disputes = new DisputesAPI(this.httpClient, this.wsClient);
    this.evidence = new EvidenceAPI(this.httpClient);

    this.setupWebSocketForwarding();
  }

  async request<T>(
    method: string,
    endpoint: string,
    data?: any,
    options?: RequestInit,
  ): Promise<T> {
    return this.httpClient.request<T>(method, endpoint, data, options);
  }

  connectWebSocket(): void {
    this.wsClient.connect();
  }

  disconnectWebSocket(): void {
    this.wsClient.disconnect();
  }

  isWebSocketConnected(): boolean {
    return this.wsClient.isConnected();
  }

  subscribe(channel: string, filters?: any): void {
    if (!this.wsClient.isConnected()) {
      this.connectWebSocket();
    }
    this.wsClient.subscribe(channel, filters);
  }

  unsubscribe(channel: string): void {
    this.wsClient.unsubscribe(channel);
  }

  disconnect(): void {
    this.disconnectWebSocket();
  }

  getConfig(): PredictLinkConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<PredictLinkConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
    this.httpClient.updateConfig(updates);
  }

  async healthCheck(): Promise<{
    status: string;
    version: string;
    timestamp: string;
  }> {
    return this.httpClient.request('GET', '/health');
  }

  private setupWebSocketForwarding(): void {
    const eventsToForward = [
      'connected',
      'disconnected',
      'error',
      'message',
      'event_status_changed',
      'new_proposal',
      'dispute_filed',
      'dispute_resolved',
      'system_alert',
      'connect_error',
      'reconnect',
      'reconnect_attempt',
      'reconnect_error',
      'reconnect_failed',
    ];

    eventsToForward.forEach(event => {
      this.wsClient.on(event, (...args: any[]) => {
        this.emit(event, ...args);
      });
    });
  }
}