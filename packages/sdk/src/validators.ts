import { PredictLinkConfig, CreateEventInput, CreateProposalInput, CreateDisputeInput } from './types';
import { ValidationError } from './errors';

export function validateConfig(config: PredictLinkConfig): void {
  if (!config) {
    throw new ValidationError('Configuration is required');
  }

  if (!config.apiUrl && !config.apiKey) {
    throw new ValidationError('Either apiUrl or apiKey must be provided');
  }

  if (config.apiUrl && !isValidUrl(config.apiUrl)) {
    throw new ValidationError('Invalid API URL format');
  }

  if (config.wsUrl && !isValidUrl(config.wsUrl)) {
    throw new ValidationError('Invalid WebSocket URL format');
  }

  if (config.timeout && (config.timeout < 1000 || config.timeout > 300000)) {
    throw new ValidationError('Timeout must be between 1000ms and 300000ms');
  }

  if (config.retries && (config.retries < 0 || config.retries > 10)) {
    throw new ValidationError('Retries must be between 0 and 10');
  }
}

export function validateCreateEventInput(input: CreateEventInput): void {
  if (!input) {
    throw new ValidationError('Event input is required');
  }

  if (!input.description || input.description.length < 10) {
    throw new ValidationError('Description must be at least 10 characters');
  }

  if (input.description.length > 500) {
    throw new ValidationError('Description must not exceed 500 characters');
  }

  if (!input.category || input.category.length < 2) {
    throw new ValidationError('Category is required and must be at least 2 characters');
  }

  if (input.resolutionTime) {
    const resolutionDate = new Date(input.resolutionTime);
    if (isNaN(resolutionDate.getTime())) {
      throw new ValidationError('Invalid resolution time format');
    }
    if (resolutionDate < new Date()) {
      throw new ValidationError('Resolution time must be in the future');
    }
  }

  if (input.metadata && typeof input.metadata !== 'object') {
    throw new ValidationError('Metadata must be an object');
  }
}

export function validateCreateProposalInput(input: CreateProposalInput): void {
  if (!input) {
    throw new ValidationError('Proposal input is required');
  }

  if (!input.eventId || input.eventId.length === 0) {
    throw new ValidationError('Event ID is required');
  }

  if (!input.outcomeData) {
    throw new ValidationError('Outcome data is required');
  }

  if (!input.evidenceUri || !isValidUrl(input.evidenceUri)) {
    throw new ValidationError('Valid evidence URI is required');
  }

  if (!input.bondAmount || parseFloat(input.bondAmount) <= 0) {
    throw new ValidationError('Bond amount must be greater than 0');
  }
}

export function validateCreateDisputeInput(input: CreateDisputeInput): void {
  if (!input) {
    throw new ValidationError('Dispute input is required');
  }

  if (!input.proposalId || input.proposalId.length === 0) {
    throw new ValidationError('Proposal ID is required');
  }

  if (!input.reason || input.reason.length < 20) {
    throw new ValidationError('Reason must be at least 20 characters');
  }

  if (input.reason.length > 1000) {
    throw new ValidationError('Reason must not exceed 1000 characters');
  }

  if (input.counterEvidenceUri && !isValidUrl(input.counterEvidenceUri)) {
    throw new ValidationError('Invalid counter evidence URI format');
  }

  if (!input.bondAmount || parseFloat(input.bondAmount) <= 0) {
    throw new ValidationError('Bond amount must be greater than 0');
  }
}

export function validateEventId(eventId: string): void {
  if (!eventId || typeof eventId !== 'string') {
    throw new ValidationError('Event ID must be a non-empty string');
  }

  if (eventId.length < 8) {
    throw new ValidationError('Event ID must be at least 8 characters');
  }
}

export function validateProposalId(proposalId: string): void {
  if (!proposalId || typeof proposalId !== 'string') {
    throw new ValidationError('Proposal ID must be a non-empty string');
  }

  if (proposalId.length < 8) {
    throw new ValidationError('Proposal ID must be at least 8 characters');
  }
}

export function validateDisputeId(disputeId: string): void {
  if (!disputeId || typeof disputeId !== 'string') {
    throw new ValidationError('Dispute ID must be a non-empty string');
  }

  if (disputeId.length < 8) {
    throw new ValidationError('Dispute ID must be at least 8 characters');
  }
}

export function validatePaginationParams(limit?: number, offset?: number): void {
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('Limit must be an integer between 1 and 100');
    }
  }

  if (offset !== undefined) {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError('Offset must be a non-negative integer');
    }
  }
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}