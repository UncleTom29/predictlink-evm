import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async checkHealth() {
    const startTime = Date.now();
    const services = [];

    try {
      const eventManagerStatus = await this.checkService(
        'Event Manager',
        this.configService.get('EVENT_MANAGER_URL'),
      );
      services.push(eventManagerStatus);
    } catch (error) {
      services.push({ name: 'Event Manager', status: 'unhealthy', latency: null });
    }

    try {
      const resolutionEngineStatus = await this.checkService(
        'Resolution Engine',
        this.configService.get('RESOLUTION_ENGINE_URL'),
      );
      services.push(resolutionEngineStatus);
    } catch (error) {
      services.push({ name: 'Resolution Engine', status: 'unhealthy', latency: null });
    }

    try {
      const blockchainServiceStatus = await this.checkService(
        'Blockchain Service',
        this.configService.get('BLOCKCHAIN_SERVICE_URL'),
      );
      services.push(blockchainServiceStatus);
    } catch (error) {
      services.push({ name: 'Blockchain Service', status: 'unhealthy', latency: null });
    }

    try {
      const mlServiceStatus = await this.checkService(
        'ML Service',
        this.configService.get('AI_SERVICE_URL'),
      );
      services.push(mlServiceStatus);
    } catch (error) {
      services.push({ name: 'ML Service', status: 'unhealthy', latency: null });
    }

    const allHealthy = services.every((s) => s.status === 'healthy');
    const overallStatus = allHealthy ? 'healthy' : 'degraded';

    return {
      status: overallStatus,
      version: process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services,
      latency: Date.now() - startTime,
    };
  }

  private async checkService(name: string, url: string) {
    const startTime = Date.now();

    try {
      await firstValueFrom(
        this.httpService.get(`${url}/health`, { timeout: 5000 }),
      );

      return {
        name,
        status: 'healthy',
        latency: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`Health check failed for ${name}: ${error.message}`);
      throw error;
    }
  }
}
