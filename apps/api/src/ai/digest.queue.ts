import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { DigestService } from './digest.service';
import { getRedisConnection } from './embed.queue';

export const DIGEST_QUEUE_NAME = 'digests';
export const DIGEST_DAILY_JOB = 'digest-daily';
export const DIGEST_REPEAT_KEY = 'daily-09-local';

export interface DigestJobData {
  date: string;
}

@Injectable()
export class DigestQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('DigestQueue');
  private queue: Queue<DigestJobData> | null = null;
  private worker: Worker<DigestJobData> | null = null;

  constructor(@Inject(DigestService) private readonly digest: DigestService) {}

  async onModuleInit(): Promise<void> {
    const connection = getRedisConnection();
    if (!connection) {
      this.logger.warn(
        'REDIS_URL is not set — digest queue will not be created'
      );
      return;
    }
    this.queue = new Queue<DigestJobData>(DIGEST_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: { age: 14 * 86_400 },
        removeOnFail: { age: 30 * 86_400 },
      },
    });
    this.worker = new Worker<DigestJobData>(
      DIGEST_QUEUE_NAME,
      async (job: Job<DigestJobData>) => {
        if (job.name === DIGEST_DAILY_JOB) {
          const date = job.data?.date ?? yesterdayLocal();
          await this.digest.generateForDate(date);
        }
      },
      { connection, concurrency: 1 }
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Digest job ${job?.id} failed: ${err.message}`
      );
    });

    if (process.env.DISABLE_DIGEST_CRON !== '1') {
      await this.queue.add(
        DIGEST_DAILY_JOB,
        {} as DigestJobData,
        {
          repeat: {
            pattern: process.env.DIGEST_CRON ?? '0 9 * * *',
            tz: process.env.TZ ?? 'Europe/Berlin',
          },
          jobId: DIGEST_REPEAT_KEY,
        }
      );
    }
    this.logger.log(`Queue '${DIGEST_QUEUE_NAME}' ready`);
  }

  async runNow(date: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(DIGEST_DAILY_JOB, { date });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

function yesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
