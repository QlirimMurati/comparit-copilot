import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { getRedisConnection } from './embed.queue';
import { TriageAgentService } from './triage-agent.service';

export const TRIAGE_QUEUE_NAME = 'triage';
export const TRIAGE_REPORT_JOB = 'triage-report';

export interface TriageReportJobData {
  reportId: string;
}

@Injectable()
export class TriageQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('TriageQueue');
  private queue: Queue<TriageReportJobData> | null = null;
  private worker: Worker<TriageReportJobData> | null = null;

  constructor(@Inject(TriageAgentService) private readonly triage: TriageAgentService) {}

  onModuleInit(): void {
    const connection = getRedisConnection();
    if (!connection) {
      this.logger.warn(
        'REDIS_URL is not set — triage queue will not be created'
      );
      return;
    }
    this.queue = new Queue<TriageReportJobData>(TRIAGE_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 1000 },
        removeOnFail: { age: 7 * 86_400 },
      },
    });
    this.worker = new Worker<TriageReportJobData>(
      TRIAGE_QUEUE_NAME,
      async (job: Job<TriageReportJobData>) => {
        if (job.name === TRIAGE_REPORT_JOB) {
          await this.triage.triage(job.data.reportId);
        }
      },
      { connection, concurrency: 2 }
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} (${job?.name}) failed: ${err.message}`
      );
    });
    this.logger.log(`Queue '${TRIAGE_QUEUE_NAME}' ready`);
  }

  async enqueueReportTriage(reportId: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(
      TRIAGE_REPORT_JOB,
      { reportId },
      { jobId: `triage:${reportId}`, delay: 2_000 }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.worker?.close();
  }
}
