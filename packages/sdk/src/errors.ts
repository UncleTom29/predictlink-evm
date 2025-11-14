export class PredictLinkError extends Error {
  public readonly statusCode?: number;
  public readonly code?: string;
  public readonly response?: any;

  constructor(message: string, statusCode?: number, code?: string, response?: any) {
    super(message);
    this.name = 'PredictLinkError';
    this.statusCode = statusCode;
    this.code = code;
    this.response = response;
    Object.setPrototypeOf(this, PredictLinkError.prototype);
  }
}

export class ValidationError extends PredictLinkError {
  constructor(message: string, response?: any) {
    super(message, 400, 'VALIDATION_ERROR', response);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends PredictLinkError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class NotFoundError extends PredictLinkError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends PredictLinkError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class NetworkError extends PredictLinkError {
  constructor(message: string = 'Network request failed') {
    super(message, 0, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends PredictLinkError {
  constructor(timeout: number) {
    super(`Request timeout after ${timeout}ms`, 0, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}

export class ServerError extends PredictLinkError {
  constructor(message: string = 'Internal server error') {
    super(message, 500, 'SERVER_ERROR');
    this.name = 'ServerError';
  }
}