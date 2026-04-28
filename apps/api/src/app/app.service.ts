import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/db.module';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  timestamp: string;
}

export interface DbHealthStatus {
  status: 'ok' | 'down';
  error?: string;
}

@Injectable()
export class AppService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  getHealth(): HealthStatus {
    return {
      status: 'ok',
      service: 'comparit-copilot-api',
      version: process.env.APP_VERSION ?? '0.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  async getDbHealth(): Promise<DbHealthStatus> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'down', error: (err as Error).message };
    }
  }
}
