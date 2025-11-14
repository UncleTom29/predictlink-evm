import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Redis from 'ioredis';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis.Redis;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis.Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      db: this.configService.get('REDIS_DB', 0),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis error:', error);
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}: ${error.message}`);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.redis.setex(key, ttl, value);
      } else {
        await this.redis.set(key, value);
      }
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}: ${error.message}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Cache delete error for key ${key}: ${error.message}`);
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.logger.error(`Cache incr error for key ${key}: ${error.message}`);
      return 0;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error(`Cache ttl error for key ${key}: ${error.message}`);
      return -1;
    }
  }
}