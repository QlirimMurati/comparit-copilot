import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, DbHealthStatus, HealthStatus } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Liveness check' })
  @ApiOkResponse({
    description: 'Service is up',
    schema: {
      example: {
        status: 'ok',
        service: 'comparit-copilot-api',
        version: '0.0.0',
        timestamp: '2026-04-28T10:14:28.191Z',
      },
    },
  })
  @Get('health')
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }

  @ApiOperation({ summary: 'Database connectivity check' })
  @ApiOkResponse({
    description: 'Database reachable',
    schema: { example: { status: 'ok' } },
  })
  @Get('health/db')
  getDbHealth(): Promise<DbHealthStatus> {
    return this.appService.getDbHealth();
  }
}
