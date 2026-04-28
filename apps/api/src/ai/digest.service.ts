import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, gte, lt } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { bugReports, type BugReport } from '../db/schema';
import { AnthropicService } from './anthropic.service';

const MODEL = 'claude-sonnet-4-6';
const DIGEST_OUTPUT_DIR = 'dist/digests';

const DIGEST_SYSTEM = `You are a delivery lead writing the daily Comparit copilot digest.

You will receive:
- The list of bug reports submitted in the day's window
- Optional Jira ticket movement summary (may be absent until W7)

Produce a concise Markdown digest with this skeleton:

## Bug intake — <DATE>

### TL;DR
- Two or three bullets capturing the most important signals

### By sparte
- list each sparte that had reports, with counts and a one-line summary

### By severity
- counts per severity, highlight any blockers

### Spikes / blockers
- only include if something stands out (e.g. 3+ reports for same sparte/area)

### Newly resolved
- if Jira data is provided, list resolved tickets here; otherwise omit this section

Rules:
- Use German if the majority of report titles are German.
- No fluff, no apologies, no "as an AI".
- If there were no reports, return a one-paragraph "no activity" digest — keep the date header.`;

export interface DigestResult {
  date: string;
  markdown: string;
  reportCount: number;
  filePath: string | null;
}

@Injectable()
export class DigestService {
  private readonly logger = new Logger('DigestService');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService
  ) {}

  async generateForDate(date: string): Promise<DigestResult> {
    if (!this.anthropic.isConfigured) {
      throw new ServiceUnavailableException(
        'AI is not configured (set ANTHROPIC_API_KEY)'
      );
    }
    const range = parseDateRange(date);
    if (!range) throw new Error(`Invalid date '${date}' (expected YYYY-MM-DD)`);

    const reports = await this.db
      .select()
      .from(bugReports)
      .where(
        and(
          gte(bugReports.createdAt, range.start),
          lt(bugReports.createdAt, range.end)
        )
      )
      .orderBy(asc(bugReports.createdAt));

    const userPrompt = this.buildPrompt(date, reports);

    const response = await this.anthropic.client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: DIGEST_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const markdown = response.content
      .map((b) =>
        b.type === 'text' && typeof (b as { text?: string }).text === 'string'
          ? (b as { text: string }).text
          : ''
      )
      .join('')
      .trim();

    const filePath = await this.writeToDisk(date, markdown);

    return {
      date,
      markdown,
      reportCount: reports.length,
      filePath,
    };
  }

  async readForDate(date: string): Promise<DigestResult | null> {
    const filePath = join(process.cwd(), DIGEST_OUTPUT_DIR, `${date}.md`);
    try {
      const markdown = await fs.readFile(filePath, 'utf8');
      return { date, markdown, reportCount: -1, filePath };
    } catch {
      return null;
    }
  }

  private async writeToDisk(
    date: string,
    markdown: string
  ): Promise<string | null> {
    try {
      const dir = join(process.cwd(), DIGEST_OUTPUT_DIR);
      await fs.mkdir(dir, { recursive: true });
      const filePath = join(dir, `${date}.md`);
      await fs.writeFile(filePath, markdown, 'utf8');
      return filePath;
    } catch (err) {
      this.logger.warn(
        `Failed to write digest to disk: ${(err as Error).message}`
      );
      return null;
    }
  }

  private buildPrompt(date: string, reports: BugReport[]): string {
    if (reports.length === 0) {
      return `## Reports submitted on ${date}\n\n_(none)_\n\nReturn a short "no activity" digest with the date header.`;
    }
    const lines = reports.map(
      (r) =>
        `- [${r.severity}/${r.sparte ?? '—'}] ${r.title} ` +
        `(id=${r.id.slice(0, 8)}, status=${r.status})`
    );
    return [
      `## Reports submitted on ${date}`,
      `Total: ${reports.length}`,
      '',
      ...lines,
      '',
      `Generate the daily digest in Markdown.`,
    ].join('\n');
  }
}

function parseDateRange(
  date: string
): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00Z`);
  if (isNaN(start.getTime())) return null;
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
