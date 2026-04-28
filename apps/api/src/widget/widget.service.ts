import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EmbedQueueService } from '../ai/embed.queue';
import { DRIZZLE, type Database } from '../db/db.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  REPORT_SEVERITIES,
  SPARTEN,
  bugReports,
  type ReportSeverity,
  type Sparte,
} from '../db/schema';
import { findOrCreateReporter } from '../users/find-or-create-reporter';
import type { WidgetReportInput, WidgetReportResult } from './widget.types';

@Injectable()
export class WidgetService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly embedQueue: EmbedQueueService,
    private readonly realtime: RealtimeGateway
  ) {}

  async submit(input: WidgetReportInput): Promise<WidgetReportResult> {
    if (!input.reporterEmail) {
      throw new BadRequestException('reporterEmail required');
    }
    if (!input.title || input.title.trim().length < 5) {
      throw new BadRequestException('title required (min 5 chars)');
    }
    if (!input.description || input.description.trim().length < 10) {
      throw new BadRequestException('description required (min 10 chars)');
    }
    if (
      input.severity &&
      !REPORT_SEVERITIES.includes(input.severity as ReportSeverity)
    ) {
      throw new BadRequestException(`invalid severity '${input.severity}'`);
    }
    if (input.sparte && !SPARTEN.includes(input.sparte as Sparte)) {
      throw new BadRequestException(`invalid sparte '${input.sparte}'`);
    }

    const reporterId = await findOrCreateReporter(
      this.db,
      input.reporterEmail
    );

    const [row] = await this.db
      .insert(bugReports)
      .values({
        reporterId,
        title: input.title.trim(),
        description: input.description.trim(),
        severity: input.severity ?? 'medium',
        sparte: input.sparte ?? null,
        capturedContext: input.capturedContext ?? null,
      })
      .returning({
        id: bugReports.id,
        status: bugReports.status,
        createdAt: bugReports.createdAt,
      });

    await this.embedQueue.enqueueReportEmbedding(row.id);
    this.realtime.emitBugReportCreated({
      reportId: row.id,
      reporterId,
      status: row.status,
      severity: input.severity ?? 'medium',
      sparte: (input.sparte as string | undefined) ?? null,
    });

    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
