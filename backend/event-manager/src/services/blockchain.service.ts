import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { EventStatus } from '../entities/event.entity';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private oracleRegistry: ethers.Contract;

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get('BNB_RPC_URL');
    const privateKey = this.configService.get('PRIVATE_KEY');
    const registryAddress = this.configService.get('ORACLE_REGISTRY_ADDRESS');

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);

    const registryABI = [
      'function createEvent(bytes32 eventId, string description, uint256 resolutionTime) external',
      'function getEvent(bytes32 eventId) external view returns (tuple(bytes32 eventId, string description, uint256 createdAt, uint256 resolutionTime, uint8 status, bytes32 outcomeHash, bytes outcome, uint256 confidenceScore, address proposer, uint256 proposerBond, uint256 disputeCount, string evidenceURI, uint256 rewardPool, bool settled))',
      'event EventCreated(bytes32 indexed eventId, string description, uint256 resolutionTime)',
      'event ProposalSubmitted(bytes32 indexed eventId, bytes32 proposalId, address proposer, bytes32 outcomeHash)',
      'event DisputeFiled(bytes32 indexed proposalId, bytes32 disputeId, address disputer)',
      'event EventResolved(bytes32 indexed eventId, bytes32 outcomeHash)',
    ];

    this.oracleRegistry = new ethers.Contract(
      registryAddress,
      registryABI,
      this.wallet,
    );
  }

  async createEventOnChain(
    eventId: string,
    description: string,
    resolutionTime: number,
  ): Promise<string> {
    try {
      const eventIdBytes = ethers.id(eventId);
      
      const tx = await this.oracleRegistry.createEvent(
        eventIdBytes,
        description,
        resolutionTime,
      );

      this.logger.log(`Transaction submitted: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      this.logger.log(`Event created on-chain: ${eventId}`);
      
      return receipt.hash;
    } catch (error) {
      this.logger.error(`Failed to create event on-chain: ${error.message}`);
      throw error;
    }
  }

  async getEventFromChain(eventId: string): Promise<any> {
    try {
      const eventIdBytes = ethers.id(eventId);
      const eventData = await this.oracleRegistry.getEvent(eventIdBytes);
      
      return {
        eventId: eventData.eventId,
        description: eventData.description,
        status: eventData.status,
        confidenceScore: eventData.confidenceScore,
        proposer: eventData.proposer,
        disputeCount: eventData.disputeCount,
      };
    } catch (error) {
      this.logger.error(`Failed to get event from chain: ${error.message}`);
      throw error;
    }
  }

  async emitEventStatusChange(eventId: string, status: EventStatus): Promise<void> {
    try {
      this.logger.log(`Emitting status change for event ${eventId}: ${status}`);
    } catch (error) {
      this.logger.error(`Failed to emit status change: ${error.message}`);
    }
  }

  async listenToEvents(): Promise<void> {
    this.oracleRegistry.on('EventCreated', (eventId: any, description: any, resolutionTime: any) => {
      this.logger.log(`Event created: ${eventId}`);
    });

    this.oracleRegistry.on('ProposalSubmitted', (eventId: any, proposalId: any, proposer: any, outcomeHash: any) => {
      this.logger.log(`Proposal submitted for event: ${eventId}`);
    });

    this.oracleRegistry.on('DisputeFiled', (proposalId: any, disputeId: any, disputer: any) => {
      this.logger.log(`Dispute filed for proposal: ${proposalId}`);
    });

    this.oracleRegistry.on('EventResolved', (eventId: any, outcomeHash: any) => {
      this.logger.log(`Event resolved: ${eventId}`);
    });
  }

  async getBalance(): Promise<string> {
    const balance = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(balance);
  }

  async getGasPrice(): Promise<string> {
    const feeData = await this.provider.getFeeData();
    return ethers.formatUnits(feeData.gasPrice || 0n, 'gwei');
  }
}

