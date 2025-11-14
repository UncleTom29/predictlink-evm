import { EventEmitter } from 'events';
import io, { Socket } from 'socket.io-client';
import { PredictLinkConfig } from '../types';
import { WEBSOCKET_EVENTS } from '../constants';

export interface WebSocketOptions {
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  reconnectionAttempts?: number;
}

export class WebSocketClient extends EventEmitter {
  private socket?: Socket;
  private config: PredictLinkConfig;
  private options: WebSocketOptions;
  private subscriptions: Set<string>;

  constructor(config: PredictLinkConfig, options: WebSocketOptions = {}) {
    super();
    this.config = config;
    this.options = {
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      ...options,
    };
    this.subscriptions = new Set();
  }

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    const wsUrl = this.config.wsUrl || 
                  this.config.apiUrl?.replace('http', 'ws') || 
                  'wss://api.predictlink.io';

    this.socket = io(`${wsUrl}/ws`, {
      auth: {
        token: this.config.apiKey,
      },
      transports: ['websocket', 'polling'],
      reconnection: this.options.reconnection,
      reconnectionDelay: this.options.reconnectionDelay,
      reconnectionDelayMax: this.options.reconnectionDelayMax,
      reconnectionAttempts: this.options.reconnectionAttempts,
      autoConnect: true,
    });

    this.setupEventHandlers();
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
      this.subscriptions.clear();
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  subscribe(channel: string, filters?: any): void {
    if (!this.socket?.connected) {
      this.connect();
    }

    const subscription = filters ? `${channel}:${JSON.stringify(filters)}` : channel;

    if (!this.subscriptions.has(subscription)) {
      this.socket?.emit('subscribe', { channel, filters });
      this.subscriptions.add(subscription);
    }
  }

  unsubscribe(channel: string): void {
    if (this.socket?.connected) {
      this.socket.emit('unsubscribe', { channel });
      
      const toRemove = Array.from(this.subscriptions).filter(sub => 
        sub.startsWith(channel)
      );
      toRemove.forEach(sub => this.subscriptions.delete(sub));
    }
  }

  send(event: string, data: any): void {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    }
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on(WEBSOCKET_EVENTS.CONNECT, () => {
      this.emit(WEBSOCKET_EVENTS.CONNECT);
      this.resubscribeAll();
    });

    this.socket.on(WEBSOCKET_EVENTS.DISCONNECT, (reason: string) => {
      this.emit(WEBSOCKET_EVENTS.DISCONNECT, reason);
    });

    this.socket.on(WEBSOCKET_EVENTS.ERROR, (error: Error) => {
      this.emit(WEBSOCKET_EVENTS.ERROR, error);
    });

    this.socket.on(WEBSOCKET_EVENTS.MESSAGE, (data: any) => {
      this.emit(WEBSOCKET_EVENTS.MESSAGE, data);
      
      if (data.type) {
        this.emit(data.type, data.data);
      }
    });

    this.socket.on(WEBSOCKET_EVENTS.EVENT_STATUS_CHANGED, (data: any) => {
      this.emit(WEBSOCKET_EVENTS.EVENT_STATUS_CHANGED, data);
    });

    this.socket.on(WEBSOCKET_EVENTS.NEW_PROPOSAL, (data: any) => {
      this.emit(WEBSOCKET_EVENTS.NEW_PROPOSAL, data);
    });

    this.socket.on(WEBSOCKET_EVENTS.DISPUTE_FILED, (data: any) => {
      this.emit(WEBSOCKET_EVENTS.DISPUTE_FILED, data);
    });

    this.socket.on(WEBSOCKET_EVENTS.DISPUTE_RESOLVED, (data: any) => {
      this.emit(WEBSOCKET_EVENTS.DISPUTE_RESOLVED, data);
    });

    this.socket.on(WEBSOCKET_EVENTS.SYSTEM_ALERT, (data: any) => {
      this.emit(WEBSOCKET_EVENTS.SYSTEM_ALERT, data);
    });

    this.socket.on('connect_error', (error: Error) => {
      this.emit('connect_error', error);
    });

    this.socket.on('reconnect', (attemptNumber: number) => {
      this.emit('reconnect', attemptNumber);
    });

    this.socket.on('reconnect_attempt', (attemptNumber: number) => {
      this.emit('reconnect_attempt', attemptNumber);
    });

    this.socket.on('reconnect_error', (error: Error) => {
      this.emit('reconnect_error', error);
    });

    this.socket.on('reconnect_failed', () => {
      this.emit('reconnect_failed');
    });
  }

  private resubscribeAll(): void {
    this.subscriptions.forEach(subscription => {
      const [channel, filtersStr] = subscription.split(':');
      const filters = filtersStr ? JSON.parse(filtersStr) : undefined;
      this.socket?.emit('subscribe', { channel, filters });
    });
  }

  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }
}