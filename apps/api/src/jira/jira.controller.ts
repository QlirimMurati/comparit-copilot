import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JiraClient, type JiraIssueRaw } from './jira.client';
import { JiraSyncQueueService } from './jira-sync.queue';
import { JqlBuilderService } from './jql-builder.service';
import { TicketsCacheService } from './tickets-cache.service';

interface SearchInput {
  rawJql?: string;
  status?: string;
  assigneeEmail?: string;
  textContains?: string;
  project?: string;
  orderBy?: 'created' | 'updated';
  maxResults?: number;
}

@UseGuards(JwtAuthGuard)
@Controller('jira')
export class JiraController {
  constructor(
    private readonly client: JiraClient,
    private readonly jql: JqlBuilderService,
    private readonly cache: TicketsCacheService,
    private readonly syncQueue: JiraSyncQueueService
  ) {}

  /**
   * POST /api/jira/search — read-only JQL search with allowlist scoping.
   *
   * The server composes / validates the JQL; the agent or UI sends typed
   * filters (or a free-form rawJql clause that gets sanity-checked first).
   */
  @Post('search')
  async search(@Body() body: SearchInput): Promise<{
    jql: string;
    total: number;
    issues: Array<{
      key: string;
      summary: string;
      status: string | null;
      issueType: string | null;
      assigneeName: string | null;
      updated: string | null;
    }>;
  }> {
    if (!this.client.isConfigured) {
      throw new ServiceUnavailableException(
        'Jira client not configured (set JIRA_BASE_URL + JIRA_USER_EMAIL + JIRA_API_TOKEN)'
      );
    }
    const jqlString = this.jql.build({
      rawJql: body.rawJql,
      status: body.status,
      assigneeEmail: body.assigneeEmail,
      textContains: body.textContains,
      project: body.project,
      orderBy: body.orderBy ?? 'updated',
    });

    const res = await this.client.searchByJql({
      jql: jqlString,
      maxResults: body.maxResults ?? 25,
    });

    return {
      jql: jqlString,
      total: res.total ?? res.issues.length,
      issues: res.issues.map((r) => ({
        key: r.key,
        summary: r.fields?.summary ?? '(no summary)',
        status: r.fields?.status?.name ?? null,
        issueType: r.fields?.issuetype?.name ?? null,
        assigneeName: r.fields?.assignee?.displayName ?? null,
        updated: r.fields?.updated ?? null,
      })),
    };
  }

  /** GET /api/jira/issue/:key — fetch single issue (read-only). */
  @Get('issue/:key')
  async getIssue(@Param('key') key: string): Promise<JiraIssueRaw> {
    if (!this.client.isConfigured) {
      throw new ServiceUnavailableException('Jira client not configured');
    }
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
      throw new BadRequestException(
        'invalid issue key (expected like LV-123)'
      );
    }
    const allowed = this.jql.allowedProjects();
    const projectKey = key.split('-')[0];
    if (!allowed.includes(projectKey)) {
      throw new BadRequestException(
        `Project '${projectKey}' not in JIRA_ALLOWED_PROJECTS`
      );
    }
    try {
      return await this.client.getIssue(key);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('404')) throw new NotFoundException(msg);
      throw err;
    }
  }

  /** GET /api/jira/whoami — verify credentials. Useful from Swagger / frontend. */
  @Get('whoami')
  async whoami() {
    if (!this.client.isConfigured) {
      throw new ServiceUnavailableException('Jira client not configured');
    }
    return this.client.whoami();
  }

  /**
   * POST /api/jira/sync/delta — admin-triggered hourly delta (also runs
   * on a cron schedule via JiraSyncQueueService).
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'qa_lead')
  @Post('sync/delta')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncDelta(): Promise<{ status: 'queued' }> {
    await this.syncQueue.runDeltaNow();
    return { status: 'queued' };
  }

  /** POST /api/jira/sync/full — admin-only full re-sync of allowed projects. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('sync/full')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncFull(): Promise<{ status: 'queued' }> {
    await this.syncQueue.runFullSyncNow();
    return { status: 'queued' };
  }

  /** GET /api/jira/cache/:key — read from local cache (no Jira call). */
  @Get('cache/:key')
  async fromCache(@Param('key') key: string) {
    const row = await this.cache.findByKey(key);
    if (!row) throw new NotFoundException(`No cached entry for ${key}`);
    return row;
  }
}
