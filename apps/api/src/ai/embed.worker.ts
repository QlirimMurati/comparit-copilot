import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { bugReports, type BugReport } from '../db/schema';
import {
  EMBED_QUEUE_NAME,
  EMBED_REPORT_JOB,
  getRedisConnection,
  type EmbedReportJobData,
} from './embed.queue';
import { VoyageService } from './voyage.service';

@Injectable()
export class EmbedWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EmbedWorker');
  private worker: Worker<EmbedReportJobData> | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly voyage: VoyageService
  ) {}

  onModuleInit(): void {
    const connection = getRedisConnection();
    if (!connection) {
      this.logger.warn(
        'REDIS_URL is not set — embedding worker will not start'
      );
      return;
    }
    if (!this.voyage.isConfigured) {
      this.logger.warn(
        'VOYAGE_API_KEY is not set — embedding worker will start but jobs will fail until configured'
      );
    }

    this.worker = new Worker<EmbedReportJobData>(
      EMBED_QUEUE_NAME,
      async (job) => {
        if (job.name === EMBED_REPORT_JOB) {
          await this.embedReport(job);
        }
      },
      { connection, concurrency: 2 }
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} (${job?.name}) failed: ${err.message}`
      );
    });
    this.logger.log(`Worker for queue '${EMBED_QUEUE_NAME}' started`);
  }

  async embedReport(job: Job<EmbedReportJobData>): Promise<void> {
    const { reportId } = job.data;

    const rows = await this.db
      .select()
      .from(bugReports)
      .where(eq(bugReports.id, reportId))
      .limit(1);
    if (rows.length === 0) {
      this.logger.warn(
        `Job ${job.id}: report ${reportId} not found — skipping`
      );
      return;
    }

    const text = this.composeEmbeddingInput(rows[0]);
    const embedding = await this.voyage.embedText(text, 'document');

    await this.db
      .update(bugReports)
      .set({ embedding, updatedAt: new Date() })
      .where(eq(bugReports.id, reportId));
  }

  private composeEmbeddingInput(report: BugReport): string {
    const parts: string[] = [
      `Title: ${report.title}`,
      `Severity: ${report.severity}`,
    ];
    if (report.sparte) parts.push(`Sparte: ${report.sparte}`);
    parts.push('', 'Description:', report.description);
    if (report.capturedContext) {
      parts.push('', `Context: ${JSON.stringify(report.capturedContext)}`);
    }
    return parts.join('\n');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
