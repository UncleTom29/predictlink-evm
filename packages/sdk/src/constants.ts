export const DEFAULT_CONFIG = {
  apiUrl: 'https://api.predictlink.online',
  timeout: 30000,
  retries: 3,
  retryDelay: 1000,
  maxRetryDelay: 10000,
} as const;

export const API_VERSION = 'v1';

export const ENDPOINTS = {
  EVENTS: '/events',
  PROPOSALS: '/proposals',
  DISPUTES: '/disputes',
  EVIDENCE: '/evidence',
  HEALTH: '/health',
  CONFIDENCE: '/confidence',
} as const;

export const WEBSOCKET_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ERROR: 'error',
  MESSAGE: 'message',
  EVENT_STATUS_CHANGED: 'event_status_changed',
  NEW_PROPOSAL: 'new_proposal',
  DISPUTE_FILED: 'dispute_filed',
  DISPUTE_RESOLVED: 'dispute_resolved',
  SYSTEM_ALERT: 'system_alert',
} as const;

export const WEBSOCKET_CHANNELS = {
  EVENTS: 'events',
  PROPOSALS: 'proposals',
  DISPUTES: 'disputes',
  MARKETS: 'markets',
} as const;

export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
} as const;

export const RATE_LIMIT = {
  DEFAULT_LIMIT: 1000,
  DEFAULT_WINDOW: 3600,
} as const;

export const EVENT_STATUS_TRANSITIONS = {
  created: ['detecting'],
  detecting: ['evidence_gathering', 'proposing'],
  evidence_gathering: ['proposing'],
  proposing: ['liveness', 'monitoring'],
  liveness: ['disputed', 'resolved'],
  monitoring: ['disputed', 'resolved'],
  disputed: ['arbitration'],
  arbitration: ['resolved'],
  resolved: ['settled'],
  settled: [],
} as const;