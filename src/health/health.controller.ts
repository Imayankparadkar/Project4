import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Application health check.
   * Returns application status and database connectivity.
   * Does NOT reveal credentials or infrastructure details.
   */
  @Get()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Returns application health status and database connectivity. ' +
      'Does not reveal credentials or infrastructure details.',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
        uptime: { type: 'number', example: 12345.67 },
        database: { type: 'string', example: 'connected' },
      },
    },
  })
  async getHealth() {
    const dbHealthy = await this.prisma.isHealthy();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealthy ? 'connected' : 'disconnected',
    };
  }
}
