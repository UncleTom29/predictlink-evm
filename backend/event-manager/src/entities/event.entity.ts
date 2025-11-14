// src/event-manager/entities/event.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

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

@Entity('events')
export class Event {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  eventId: string;

  @Column('text')
  description: string;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  subcategory: string;

  @Column({
    type: 'enum',
    enum: EventStatus,
    default: EventStatus.CREATED,
  })
  status: EventStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'bytea', nullable: true })
  outcomeHash: Buffer;

  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true })
  confidenceScore: number;

  @Column({ nullable: true })
  proposerAddress: string;

  @Column({ type: 'decimal', precision: 78, scale: 0, nullable: true })
  proposerBond: string;

  @Column({ type: 'int', default: 0 })
  disputeCount: number;

  @Column({ type: 'timestamp', nullable: true })
  resolutionTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
