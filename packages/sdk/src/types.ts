// packages/sdk/src/types.ts
export interface PredictLinkConfig {
  apiUrl?: string;
  wsUrl?: string;
  apiKey?: string;
  timeout?: number;
  retries?: number;
}

export enum EventStatus {
  CREATED = 'created',
  DETECTING = 'detecting',
  EVIDENCE_GATHERING = 'evidence_gathering',
  PROPOSING = 'proposing',
  LIVENESS = 'liveness',
  MONITORING = 'monitoring',
  DISPUTED = 'disputed',
  ARBITRATION = 'arbitration',
  RESOLVED = 'resolved',
  SETTLED = 'settled',
}

export interface Event {
  id: string;
  eventId: string;
  description: string;
  category: string;
  subcategory?: string;
  status: EventStatus;
  confidenceScore?: number;
  outcomeHash?: string;
  proposerAddress?: string;
  proposerBond?: string;
  disputeCount: number;
  resolutionTime?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

export interface Proposal {
  id: string;
  eventId: string;
  proposerAddress: string;
  outcomeData: any;
  outcomeHash: string;
  confidenceScore: number;
  evidenceUri: string;
  bondAmount: string;
  createdAt: string;
  finalizedAt?: string;
  status: string;
}

export interface Dispute {
  id: string;
  proposalId: string;
  disputerAddress: string;
  reason: string;
  counterEvidenceUri?: string;
  bondAmount: string;
  createdAt: string;
  resolvedAt?: string;
  outcome?: 'upheld' | 'rejected' | 'pending';
}

export interface Evidence {
  id: string;
  eventId: string;
  sources: EvidenceSource[];
  evidenceHash: string;
  storageUri: string;
  collectedAt: string;
  metadata?: Record<string, any>;
}

export interface EvidenceSource {
  type: string;
  url: string;
  dataHash: string;
  credibilityScore: number;
  timestamp: string;
}

export interface ConfidenceScore {
  eventId: string;
  confidenceScore: number;
  xgbScore: number;
  nnScore: number;
  uncertainty: number;
  recommendation: 'auto_propose' | 'human_review' | 'insufficient_data';
  featureImportance: Record<string, number>;
  timestamp: string;
}

export interface CreateEventInput {
  description: string;
  category: string;
  resolutionTime?: string;
  metadata?: Record<string, any>;
}

export interface CreateProposalInput {
  eventId: string;
  outcomeData: any;
  evidenceUri: string;
  bondAmount: string;
}

export interface CreateDisputeInput {
  proposalId: string;
  reason: string;
  counterEvidenceUri?: string;
  bondAmount: string;
}

export interface EventFilter {
  status?: EventStatus;
  category?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
