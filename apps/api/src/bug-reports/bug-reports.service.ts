import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { EmbedQueueService } from '../ai/embed.queue';
import { TriageQueueService } from '../ai/triage.queue';
import { DRIZZLE, type Database } from '../db/db.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  SPARTEN,
  bugReports,
  users,
  type BugReport,
  type ReportSeverity,
  type ReportStatus,
  type Sparte,
} from '../db/schema';
import type {
  BugReportRecord,
  CreateBugReportInput,
  ListBugReportsFilter,
  UpdateBugReportInput,
} from './bug-reports.types';

@Injectable()
export class BugReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly embedQueue: EmbedQueueService,
    private readonly triageQueue: TriageQueueService,
    private readonly realtime: RealtimeGateway
  ) {}

  async list(filter: ListBugReportsFilter): Promise<BugReportRecord[]> {
    const conds: SQL[] = [];
    if (filter.status) conds.push(eq(bugReports.status, filter.status));
    if (filter.severity) conds.push(eq(bugReports.severity, filter.severity));
    if (filter.sparte) conds.push(eq(bugReports.sparte, filter.sparte));
    if (filter.type) conds.push(eq(bugReports.type, filter.type));
    if (filter.reporterId)
      conds.push(eq(bugReports.reporterId, filter.reporterId));

    const rows = await this.db
      .select({
        report: bugReports,
        reporter: {
          id: users.id,
          name: users.name,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(bugReports)
      .leftJoin(users, eq(bugReports.reporterId, users.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(bugReports.createdAt))
      .limit(200);

    return rows.map((r) => ({ ...r.report, reporter: r.reporter ?? undefined }));
  }

  async getById(id: string): Promise<BugReportRecord> {
    const rows = await this.db
      .select({
        report: bugReports,
        reporter: {
          id: users.id,
          name: users.name,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(bugReports)
      .leftJoin(users, eq(bugReports.reporterId, users.id))
      .where(eq(bugReports.id, id))
      .limit(1);

    if (rows.length === 0) throw new NotFoundException(`Report ${id} not found`);
    return { ...rows[0].report, reporter: rows[0].reporter ?? undefined };
  }

  async create(
    reporterId: string,
    input: CreateBugReportInput
  ): Promise<BugReport> {
    this.validateInput(input);

    const [row] = await this.db
      .insert(bugReports)
      .values({
        reporterId,
        title: input.title.trim(),
        description: input.description.trim(),
        severity: input.severity ?? 'medium',
        sparte: input.sparte ?? null,
        type: input.type ?? 'bug',
        capturedContext: input.capturedContext ?? null,
      })
      .returning();

    await this.embedQueue.enqueueReportEmbedding(row.id);
    await this.triageQueue.enqueueReportTriage(row.id);
    this.realtime.emitBugReportCreated({
      reportId: row.id,
      reporterId: row.reporterId,
      status: row.status,
      severity: row.severity,
      sparte: row.sparte,
    });

    return row;
  }

  async update(id: string, patch: UpdateBugReportInput): Promise<BugReport> {
    if (patch.status && !REPORT_STATUSES.includes(patch.status)) {
      throw new BadRequestException(`invalid status '${patch.status}'`);
    }
    if (patch.severity && !REPORT_SEVERITIES.includes(patch.severity)) {
      throw new BadRequestException(`invalid severity '${patch.severity}'`);
    }
    if (patch.sparte && !SPARTEN.includes(patch.sparte)) {
      throw new BadRequestException(`invalid sparte '${patch.sparte}'`);
    }

    const [row] = await this.db
      .update(bugReports)
      .set({
        ...(patch.title !== undefined && { title: patch.title.trim() }),
        ...(patch.description !== undefined && {
          description: patch.description.trim(),
        }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.severity !== undefined && { severity: patch.severity }),
        ...(patch.sparte !== undefined && { sparte: patch.sparte }),
        ...(patch.jiraIssueKey !== undefined && {
          jiraIssueKey: patch.jiraIssueKey,
        }),
        updatedAt: new Date(),
      })
      .where(eq(bugReports.id, id))
      .returning();

    if (!row) throw new NotFoundException(`Report ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .delete(bugReports)
      .where(eq(bugReports.id, id))
      .returning({ id: bugReports.id });
    if (!row) throw new NotFoundException(`Report ${id} not found`);
    return row;
  }

  private validateInput(input: CreateBugReportInput): void {
    if (!input.title || input.title.trim().length < 5) {
      throw new BadRequestException('title is required (min 5 chars)');
    }
    if (!input.description || input.description.trim().length < 10) {
      throw new BadRequestException('description is required (min 10 chars)');
    }
    if (input.severity && !REPORT_SEVERITIES.includes(input.severity)) {
      throw new BadRequestException(`invalid severity '${input.severity}'`);
    }
    if (input.sparte && !SPARTEN.includes(input.sparte)) {
      throw new BadRequestException(`invalid sparte '${input.sparte}'`);
    }
  }

  // exposed so the controller can keep its parsing logic
  isValidStatus(s: unknown): s is ReportStatus {
    return typeof s === 'string' && REPORT_STATUSES.includes(s as ReportStatus);
  }
  isValidSeverity(s: unknown): s is ReportSeverity {
    return (
      typeof s === 'string' && REPORT_SEVERITIES.includes(s as ReportSeverity)
    );
  }
  isValidSparte(s: unknown): s is Sparte {
    return typeof s === 'string' && SPARTEN.includes(s as Sparte);
  }
}
