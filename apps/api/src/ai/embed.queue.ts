import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';

export const EMBED_QUEUE_NAME = 'embeddings';
export const EMBED_REPORT_JOB = 'embed-report';

export interface EmbedReportJobData {
  reportId: string;
}

export function getRedisConnection(): ConnectionOptions | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class EmbedQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EmbedQueueService');
  private queue: Queue<EmbedReportJobData> | null = null;

  onModuleInit(): void {
    const connection = getRedisConnection();
    if (!connection) {
      this.logger.warn(
        'REDIS_URL is not set — embedding jobs will not be queued (running offline)'
      );
      return;
    }
    this.queue = new Queue<EmbedReportJobData>(EMBED_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 1000 },
        removeOnFail: { age: 7 * 86_400 },
      },
    });
    this.logger.log(`Queue '${EMBED_QUEUE_NAME}' ready`);
  }

  async enqueueReportEmbedding(reportId: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(
      EMBED_REPORT_JOB,
      { reportId },
      { jobId: `report-${reportId}` }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
