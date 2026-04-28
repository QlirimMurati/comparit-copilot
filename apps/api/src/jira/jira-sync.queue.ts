import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { getRedisConnection } from '../ai/embed.queue';
import { TicketsCacheService } from './tickets-cache.service';

export const JIRA_SYNC_QUEUE_NAME = 'jira-sync';
export const JIRA_DELTA_JOB = 'jira-delta';
export const JIRA_FULL_JOB = 'jira-full';
export const JIRA_DELTA_REPEAT_KEY = 'jira-delta-hourly';

interface JobData {
  // No payload — both jobs operate on the configured allowlist.
  kind?: 'delta' | 'full';
}

@Injectable()
export class JiraSyncQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('JiraSyncQueue');
  private queue: Queue<JobData> | null = null;
  private worker: Worker<JobData> | null = null;

  constructor(@Inject(TicketsCacheService) private readonly cache: TicketsCacheService) {}

  async onModuleInit(): Promise<void> {
    const connection = getRedisConnection();
    if (!connection) {
      this.logger.warn(
        'REDIS_URL is not set — Jira sync queue will not be created'
      );
      return;
    }

    this.queue = new Queue<JobData>(JIRA_SYNC_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: { age: 7 * 86_400 },
        removeOnFail: { age: 30 * 86_400 },
      },
    });

    this.worker = new Worker<JobData>(
      JIRA_SYNC_QUEUE_NAME,
      async (job: Job<JobData>) => {
        if (job.name === JIRA_DELTA_JOB) {
          return await this.cache.syncDelta();
        }
        if (job.name === JIRA_FULL_JOB) {
          return await this.cache.syncAllAllowedProjects();
        }
      },
      { connection, concurrency: 1 }
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Sync job ${job?.id} (${job?.name}) failed: ${err.message}`
      );
    });

    if (process.env.DISABLE_JIRA_SYNC_CRON !== '1') {
      await this.queue.add(
        JIRA_DELTA_JOB,
        { kind: 'delta' },
        {
          repeat: {
            pattern: process.env.JIRA_DELTA_CRON ?? '0 * * * *',
            tz: process.env.TZ ?? 'Europe/Berlin',
          },
          jobId: JIRA_DELTA_REPEAT_KEY,
        }
      );
    }
    this.logger.log(`Queue '${JIRA_SYNC_QUEUE_NAME}' ready`);
  }

  async runDeltaNow(): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(JIRA_DELTA_JOB, { kind: 'delta' });
  }

  async runFullSyncNow(): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(JIRA_FULL_JOB, { kind: 'full' });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
