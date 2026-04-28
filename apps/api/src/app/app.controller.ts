import { Controller, Get } from '@nestjs/common';
import { AppService, DbHealthStatus, HealthStatus } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }

  @Get('health/db')
  getDbHealth(): Promise<DbHealthStatus> {
    return this.appService.getDbHealth();
  }
}
