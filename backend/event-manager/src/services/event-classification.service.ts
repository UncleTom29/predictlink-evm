
// src/event-manager/event-classification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ClassificationResult {
  primaryCategory: string;
  subcategory: string;
  confidence: number;
  timeSensitivity: 'low' | 'medium' | 'high';
  objectivity: 'objective' | 'subjective' | 'mixed';
  recommendedAction: 'auto_process' | 'human_review' | 'reject';
}

@Injectable()
export class EventClassificationService {
  private readonly logger = new Logger(EventClassificationService.name);

  constructor(private configService: ConfigService) {}

  async classify(description: string, sources: any[]): Promise<ClassificationResult> {
    try {
      // Call AI classification service
      const response = await fetch(
        `${this.configService.get('AI_SERVICE_URL')}/classify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, sources }),
        },
      );

      if (!response.ok) {
        throw new Error(`Classification failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result as ClassificationResult;
    } catch (error) {
      this.logger.error(`Classification error: ${error.message}`);
      
      // Fallback to rule-based classification
      return this.fallbackClassification(description);
    }
  }

  private fallbackClassification(description: string): ClassificationResult {
    const lowerDesc = description.toLowerCase();

    // Simple keyword-based classification
    if (lowerDesc.includes('game') || lowerDesc.includes('match') || lowerDesc.includes('score')) {
      return {
        primaryCategory: 'sports',
        subcategory: 'general',
        confidence: 0.7,
        timeSensitivity: 'high',
        objectivity: 'objective',
        recommendedAction: 'auto_process',
      };
    }

    if (lowerDesc.includes('election') || lowerDesc.includes('vote') || lowerDesc.includes('poll')) {
      return {
        primaryCategory: 'politics',
        subcategory: 'elections',
        confidence: 0.7,
        timeSensitivity: 'medium',
        objectivity: 'objective',
        recommendedAction: 'human_review',
      };
    }

    // Default classification
    return {
      primaryCategory: 'general',
      subcategory: 'unknown',
      confidence: 0.5,
      timeSensitivity: 'low',
      objectivity: 'mixed',
      recommendedAction: 'human_review',
    };
  }
}