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
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected');
    });

    this.redis.on('error', (error: any) => {
      this.logger.error('Redis connection error:', error);
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.error(`Failed to get key ${key}: ${error.message}`);
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
      this.logger.error(`Failed to set key ${key}: ${error.message}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Failed to delete key ${key}: ${error.message}`);
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.logger.error(`Failed to increment key ${key}: ${error.message}`);
      return 0;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error(`Failed to get TTL for key ${key}: ${error.message}`);
      return -1;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to check existence of key ${key}: ${error.message}`);
      return false;
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    try {
      return await this.redis.mget(...keys);
    } catch (error) {
      this.logger.error(`Failed to get multiple keys: ${error.message}`);
      return keys.map(() => null);
    }
  }

  async mset(data: Record<string, string>): Promise<void> {
    try {
      const pairs: string[] = [];
      Object.entries(data).forEach(([key, value]) => {
        pairs.push(key, value);
      });
      await this.redis.mset(...pairs);
    } catch (error) {
      this.logger.error(`Failed to set multiple keys: ${error.message}`);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.redis.keys(pattern);
    } catch (error) {
      this.logger.error(`Failed to get keys with pattern ${pattern}: ${error.message}`);
      return [];
    }
  }

  async flush(): Promise<void> {
    try {
      await this.redis.flushdb();
      this.logger.log('Cache flushed');
    } catch (error) {
      this.logger.error(`Failed to flush cache: ${error.message}`);
    }
  }

  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.redis.hget(key, field);
    } catch (error) {
      this.logger.error(`Failed to hget ${key}:${field}: ${error.message}`);
      return null;
    }
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    try {
      await this.redis.hset(key, field, value);
    } catch (error) {
      this.logger.error(`Failed to hset ${key}:${field}: ${error.message}`);
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.redis.hgetall(key);
    } catch (error) {
      this.logger.error(`Failed to hgetall ${key}: ${error.message}`);
      return {};
    }
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.redis.lpush(key, ...values);
    } catch (error) {
      this.logger.error(`Failed to lpush to ${key}: ${error.message}`);
      return 0;
    }
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.redis.rpush(key, ...values);
    } catch (error) {
      this.logger.error(`Failed to rpush to ${key}: ${error.message}`);
      return 0;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.redis.lrange(key, start, stop);
    } catch (error) {
      this.logger.error(`Failed to lrange ${key}: ${error.message}`);
      return [];
    }
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    try {
      return await this.redis.zadd(key, score, member);
    } catch (error) {
      this.logger.error(`Failed to zadd to ${key}: ${error.message}`);
      return 0;
    }
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.redis.zrange(key, start, stop);
    } catch (error) {
      this.logger.error(`Failed to zrange ${key}: ${error.message}`);
      return [];
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}