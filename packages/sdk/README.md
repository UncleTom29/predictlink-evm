# @predictlink/sdk

Official TypeScript/JavaScript SDK for PredictLink Oracle

## Installation

```bash
npm install @predictlink/sdk
# or
yarn add @predictlink/sdk
# or
pnpm add @predictlink/sdk
```

## Quick Start

```typescript
import { PredictLinkClient } from '@predictlink/sdk';

const client = new PredictLinkClient({
  apiKey: 'your-api-key',
  apiUrl: 'https://api.predictlink.online'
});

const event = await client.events.create({
  description: 'Super Bowl 2025 Winner',
  category: 'sports',
  resolutionTime: '2025-02-09T23:00:00Z'
});

console.log('Event created:', event.id);
```

## Configuration

```typescript
const client = new PredictLinkClient({
  apiUrl: 'https://api.predictlink.online',  // Optional, defaults to production
  apiKey: 'your-api-key',                // Required
  timeout: 30000,                         // Optional, request timeout in ms
  retries: 3,                            // Optional, number of retries
});
```

## API Reference

### Events

```typescript
const event = await client.events.create({
  description: 'Event description',
  category: 'sports'
});

const retrieved = await client.events.get(event.id);

const events = await client.events.list({
  category: 'sports',
  limit: 10
});

const updated = await client.events.update(event.id, {
  metadata: { custom: 'data' }
});

await client.events.triggerDetection(event.id);

const confidence = await client.events.getConfidence(event.id);

client.events.subscribeToUpdates(event.id, (updatedEvent) => {
  console.log('Event updated:', updatedEvent);
});
```

### Proposals

```typescript
const proposal = await client.proposals.submit({
  eventId: 'event-id',
  outcomeData: { winner: 'Team A' },
  evidenceUri: 'ipfs://...',
  bondAmount: '1000'
});

const retrieved = await client.proposals.get(proposal.id);

const proposals = await client.proposals.list({
  eventId: 'event-id',
  limit: 10
});

await client.proposals.finalize(proposal.id);

client.proposals.subscribeToNew('event-id', (newProposal) => {
  console.log('New proposal:', newProposal);
});
```

### Disputes

```typescript
const dispute = await client.disputes.file({
  proposalId: 'proposal-id',
  reason: 'Detailed reason for dispute',
  bondAmount: '500'
});

const retrieved = await client.disputes.get(dispute.id);

const disputes = await client.disputes.list({
  proposalId: 'proposal-id'
});

await client.disputes.resolve(dispute.id, 'upheld');

client.disputes.subscribeToDisputes('proposal-id', (dispute) => {
  console.log('Dispute filed:', dispute);
});
```

### Evidence

```typescript
const evidence = await client.evidence.get('event-id');

const verified = await client.evidence.verify(
  'event-id',
  'evidence-hash'
);

const sources = await client.evidence.getSources('event-id');
```

## WebSocket Real-time Updates

```typescript
client.connectWebSocket();

client.on('connected', () => {
  console.log('WebSocket connected');
});

client.on('event_status_changed', (data) => {
  console.log('Event status changed:', data);
});

client.on('new_proposal', (data) => {
  console.log('New proposal:', data);
});

client.on('dispute_filed', (data) => {
  console.log('Dispute filed:', data);
});

client.disconnectWebSocket();
```

## Error Handling

```typescript
import { 
  PredictLinkError,
  ValidationError,
  AuthenticationError,
  NotFoundError,
  RateLimitError 
} from '@predictlink/sdk';

try {
  const event = await client.events.get('invalid-id');
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation failed:', error.message);
  } else if (error instanceof AuthenticationError) {
    console.error('Authentication failed');
  } else if (error instanceof NotFoundError) {
    console.error('Resource not found');
  } else if (error instanceof RateLimitError) {
    console.error('Rate limit exceeded, retry after:', error.retryAfter);
  } else if (error instanceof PredictLinkError) {
    console.error('API error:', error.message, error.statusCode);
  }
}
```

## TypeScript Support

Full TypeScript support with type definitions included.

```typescript
import { 
  Event, 
  Proposal, 
  Dispute, 
  EventStatus,
  CreateEventInput 
} from '@predictlink/sdk';

const input: CreateEventInput = {
  description: 'Event description',
  category: 'sports'
};

const event: Event = await client.events.create(input);
```

## Advanced Usage

### Custom Request Options

```typescript
const event = await client.request<Event>(
  'POST',
  '/events',
  { description: 'Custom request' },
  {
    headers: {
      'X-Custom-Header': 'value'
    }
  }
);
```

### Health Check

```typescript
const health = await client.healthCheck();
console.log('API Status:', health.status);
```

### Update Configuration

```typescript
client.updateConfig({
  timeout: 60000,
  retries: 5
});
```

## Examples

See [examples](./examples) directory for more usage examples.

## License

MIT

