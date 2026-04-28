import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { cosineDistance, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { bugReports, ticketsCache } from '../db/schema';
import { VoyageService } from './voyage.service';

const DEFAULT_LIMIT = 5;
const DEFAULT_DISTANCE_CEILING = 0.35;

export interface CheckDuplicateInput {
  title: string;
  description: string;
  sparte?: string | null;
  limit?: number;
  /** Cosine distance ceiling (0 = identical, 2 = opposite). Lower = stricter. */
  maxDistance?: number;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  status: string;
  severity: string;
  sparte: string | null;
  jiraIssueKey: string | null;
  createdAt: string;
  /** Cosine distance — closer to 0 means more similar. */
  distance: number;
}

export interface DuplicateTicketCandidate {
  jiraIssueKey: string;
  projectKey: string;
  summary: string;
  status: string | null;
  issueType: string | null;
  assigneeName: string | null;
  jiraUpdated: string | null;
  /** Cosine distance — closer to 0 means more similar. */
  distance: number;
}

export interface CrossSourceDedupResult {
  similarReports: DuplicateCandidate[];
  similarTickets: DuplicateTicketCandidate[];
}

@Injectable()
export class DedupService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly voyage: VoyageService
  ) {}

  async checkDuplicate(
    input: CheckDuplicateInput
  ): Promise<DuplicateCandidate[]> {
    if (!this.voyage.isConfigured) {
      throw new ServiceUnavailableException(
        'Voyage embeddings are not configured (set VOYAGE_API_KEY)'
      );
    }
    const limit = clamp(input.limit ?? DEFAULT_LIMIT, 1, 20);
    const ceiling = clampNumber(
      input.maxDistance ?? DEFAULT_DISTANCE_CEILING,
      0,
      2
    );

    const queryText = composeQueryText(input);
    const queryVec = await this.voyage.embedText(queryText, 'query');

    const distance = cosineDistance(bugReports.embedding, queryVec);

    const rows = await this.db
      .select({
        id: bugReports.id,
        title: bugReports.title,
        status: bugReports.status,
        severity: bugReports.severity,
        sparte: bugReports.sparte,
        jiraIssueKey: bugReports.jiraIssueKey,
        createdAt: bugReports.createdAt,
        distance: sql<number>`${distance}`.as('distance'),
      })
      .from(bugReports)
      .where(isNotNull(bugReports.embedding))
      .orderBy(distance)
      .limit(limit);

    return rows
      .filter((r) => r.distance <= ceiling)
      .map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        severity: r.severity,
        sparte: r.sparte ?? null,
        jiraIssueKey: r.jiraIssueKey ?? null,
        createdAt: r.createdAt.toISOString(),
        distance: Number(r.distance),
      }));
  }

  /**
   * Cross-source dedup (W17): query both `bug_reports` and `tickets_cache`
   * for similar entries and return them in two lists. The query embedding
   * is computed once and reused against both vector columns since both
   * columns use the same Voyage model + dimension.
   */
  async checkDuplicateAcrossSources(
    input: CheckDuplicateInput
  ): Promise<CrossSourceDedupResult> {
    if (!this.voyage.isConfigured) {
      throw new ServiceUnavailableException(
        'Voyage embeddings are not configured (set VOYAGE_API_KEY)'
      );
    }
    const limit = clamp(input.limit ?? DEFAULT_LIMIT, 1, 20);
    const ceiling = clampNumber(
      input.maxDistance ?? DEFAULT_DISTANCE_CEILING,
      0,
      2
    );

    const queryText = composeQueryText(input);
    const queryVec = await this.voyage.embedText(queryText, 'query');

    const reportDistance = cosineDistance(bugReports.embedding, queryVec);
    const ticketDistance = cosineDistance(ticketsCache.embedding, queryVec);

    const [reportRows, ticketRows] = await Promise.all([
      this.db
        .select({
          id: bugReports.id,
          title: bugReports.title,
          status: bugReports.status,
          severity: bugReports.severity,
          sparte: bugReports.sparte,
          jiraIssueKey: bugReports.jiraIssueKey,
          createdAt: bugReports.createdAt,
          distance: sql<number>`${reportDistance}`.as('distance'),
        })
        .from(bugReports)
        .where(isNotNull(bugReports.embedding))
        .orderBy(reportDistance)
        .limit(limit),
      this.db
        .select({
          jiraIssueKey: ticketsCache.jiraIssueKey,
          projectKey: ticketsCache.projectKey,
          summary: ticketsCache.summary,
          status: ticketsCache.status,
          issueType: ticketsCache.issueType,
          assigneeName: ticketsCache.assigneeName,
          jiraUpdated: ticketsCache.jiraUpdated,
          distance: sql<number>`${ticketDistance}`.as('distance'),
        })
        .from(ticketsCache)
        .where(isNotNull(ticketsCache.embedding))
        .orderBy(ticketDistance)
        .limit(limit),
    ]);

    const similarReports: DuplicateCandidate[] = reportRows
      .filter((r) => r.distance <= ceiling)
      .map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        severity: r.severity,
        sparte: r.sparte ?? null,
        jiraIssueKey: r.jiraIssueKey ?? null,
        createdAt: r.createdAt.toISOString(),
        distance: Number(r.distance),
      }));

    const similarTickets: DuplicateTicketCandidate[] = ticketRows
      .filter((r) => r.distance <= ceiling)
      .map((r) => ({
        jiraIssueKey: r.jiraIssueKey,
        projectKey: r.projectKey,
        summary: r.summary,
        status: r.status ?? null,
        issueType: r.issueType ?? null,
        assigneeName: r.assigneeName ?? null,
        jiraUpdated: r.jiraUpdated ? r.jiraUpdated.toISOString() : null,
        distance: Number(r.distance),
      }));

    return { similarReports, similarTickets };
  }
}

function composeQueryText(input: CheckDuplicateInput): string {
  const parts = [`Title: ${input.title.trim()}`];
  if (input.sparte) parts.push(`Sparte: ${input.sparte}`);
  parts.push('', 'Description:', input.description.trim());
  return parts.join('\n');
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
