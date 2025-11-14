import { PredictLinkConfig } from '../types';
import { 
  PredictLinkError, 
  AuthenticationError, 
  RateLimitError, 
  NetworkError, 
  TimeoutError, 
  ServerError 
} from '../errors';
import { DEFAULT_CONFIG, API_VERSION } from '../constants';

export class HttpClient {
  private config: Required<PredictLinkConfig>;

  constructor(config: PredictLinkConfig) {
    this.config = {
      apiUrl: config.apiUrl || DEFAULT_CONFIG.apiUrl,
      wsUrl: config.wsUrl || config.apiUrl?.replace('http', 'ws') || '',
      apiKey: config.apiKey || '',
      timeout: config.timeout || DEFAULT_CONFIG.timeout,
      retries: config.retries || DEFAULT_CONFIG.retries,
    };
  }

  async request<T>(
    method: string,
    endpoint: string,
    data?: any,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.config.apiUrl}/api/${API_VERSION}${endpoint}`;
    const headers = this.buildHeaders(options?.headers);

    let lastError: Error | null = null;
    const maxRetries = this.config.retries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout
        );

        const response = await fetch(url, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
          signal: controller.signal,
          ...options,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await this.handleErrorResponse(response);
          
          if (this.shouldRetry(error, attempt, maxRetries)) {
            await this.delay(this.getRetryDelay(attempt));
            continue;
          }
          
          throw error;
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await response.json();
        }

        return (await response.text()) as unknown as T;

      } catch (error) {
        if (error instanceof PredictLinkError) {
          lastError = error;
        } else if ((error as any).name === 'AbortError') {
          lastError = new TimeoutError(this.config.timeout);
        } else {
          lastError = new NetworkError((error as Error).message);
        }

        if (!this.shouldRetry(lastError, attempt, maxRetries)) {
          throw lastError;
        }

        await this.delay(this.getRetryDelay(attempt));
      }
    }

    throw lastError || new NetworkError('Request failed after retries');
  }

  private buildHeaders(customHeaders?: HeadersInit): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'User-Agent': 'PredictLink-SDK/1.0.0',
      ...customHeaders,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private async handleErrorResponse(response: Response): Promise<PredictLinkError> {
    let errorData: any;

    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }

    const message = errorData.message || errorData.error || 'API request failed';

    switch (response.status) {
      case 400:
        return new PredictLinkError(message, 400, 'BAD_REQUEST', errorData);
      case 401:
        return new AuthenticationError(message);
      case 404:
        return new PredictLinkError(message, 404, 'NOT_FOUND', errorData);
      case 429:
        const retryAfter = errorData.retryAfter || 
                          parseInt(response.headers.get('Retry-After') || '60', 10);
        return new RateLimitError(retryAfter);
      case 500:
      case 502:
      case 503:
      case 504:
        return new ServerError(message);
      default:
        return new PredictLinkError(message, response.status, 'UNKNOWN_ERROR', errorData);
    }
  }

  private shouldRetry(error: Error, attempt: number, maxRetries: number): boolean {
    if (attempt >= maxRetries) {
      return false;
    }

    if (error instanceof AuthenticationError) {
      return false;
    }

    if (error instanceof PredictLinkError) {
      const statusCode = error.statusCode || 0;
      if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        return false;
      }
    }

    return true;
  }

  private getRetryDelay(attempt: number): number {
    const baseDelay = DEFAULT_CONFIG.retryDelay;
    const maxDelay = DEFAULT_CONFIG.maxRetryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getConfig(): Required<PredictLinkConfig> {
    return { ...this.config };
  }

  updateConfig(updates: Partial<PredictLinkConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }
}