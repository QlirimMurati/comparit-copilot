import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  DedupService,
  type CheckDuplicateInput,
  type CrossSourceDedupResult,
  type DuplicateCandidate,
} from '../ai/dedup.service';
import {
  CodeLocalizerService,
  type LocalizationResult,
} from '../ai/code-localizer.service';
import {
  TestCaseGeneratorService,
  type GeneratedTestStub,
} from '../ai/test-case-generator.service';
import { TicketPolisherService } from '../ai/ticket-polisher.service';
import type { PolishedTicket } from '../ai/ticket-polisher.schema';
import {
  PushToJiraService,
  type JiraPushPreview,
  type JiraPushResult,
} from '../jira/push-to-jira.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { PublicUser } from '../auth/auth.types';
import type { BugReport } from '../db/schema';
import { BugReportsService } from './bug-reports.service';
import type {
  BugReportRecord,
  CreateBugReportInput,
  ListBugReportsFilter,
  UpdateBugReportInput,
} from './bug-reports.types';

@ApiTags('reports')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class BugReportsController {
  constructor(
    private readonly reports: BugReportsService,
    private readonly polisher: TicketPolisherService,
    private readonly dedup: DedupService,
    private readonly testGenerator: TestCaseGeneratorService,
    private readonly localizer: CodeLocalizerService,
    private readonly pushToJira: PushToJiraService
  ) {}

  @ApiOperation({ summary: 'List bug reports (filterable)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'sparte', required: false })
  @ApiQuery({
    name: 'mine',
    required: false,
    description: 'When `true`, only reports owned by the current user',
  })
  @Get()
  list(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('sparte') sparte?: string,
    @Query('mine') mine?: string,
    @CurrentUser() user?: PublicUser
  ): Promise<BugReportRecord[]> {
    const filter: ListBugReportsFilter = {};
    if (status && this.reports.isValidStatus(status)) filter.status = status;
    if (severity && this.reports.isValidSeverity(severity))
      filter.severity = severity;
    if (sparte && this.reports.isValidSparte(sparte)) filter.sparte = sparte;
    if (mine === 'true' && user) filter.reporterId = user.id;
    return this.reports.list(filter);
  }

  @ApiOperation({ summary: 'Get a single bug report by id' })
  @Get(':id')
  get(@Param('id') id: string): Promise<BugReportRecord> {
    return this.reports.getById(id);
  }

  @ApiOperation({ summary: 'Create a bug report' })
  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Body() body: CreateBugReportInput
  ): Promise<BugReport> {
    if (!user) throw new BadRequestException('user context required');
    return this.reports.create(user.id, body);
  }

  @ApiOperation({ summary: 'Update a bug report' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateBugReportInput
  ): Promise<BugReport> {
    return this.reports.update(id, body);
  }

  @ApiOperation({ summary: 'Polish a bug report ticket' })
  @Post(':id/polish')
  polish(@Param('id') id: string): Promise<PolishedTicket> {
    return this.polisher.polish(id);
  }

  @ApiOperation({ summary: 'Generate a test stub for a bug report' })
  @Post(':id/generate-test-stub')
  generateTestStub(@Param('id') id: string): Promise<GeneratedTestStub> {
    return this.testGenerator.generate(id);
  }

  @ApiOperation({ summary: 'Localize the code area for a bug report' })
  @Post(':id/localize')
  localize(@Param('id') id: string): Promise<LocalizationResult> {
    return this.localizer.localize(id);
  }

  /**
   * SAFETY: this endpoint does NOT call Jira. It returns the prepared
   * payload + previewHash so the user can review before confirming.
   */
  @Post(':id/push-to-jira/preview')
  pushToJiraPreview(@Param('id') id: string): Promise<JiraPushPreview> {
    return this.pushToJira.preview(id);
  }

  /**
   * SAFETY: this is the only place where copilot calls Jira's createIssue.
   * Requires the previewHash that the user just saw — guarantees the
   * preview-vs-confirm payloads match.
   */
  @Post(':id/push-to-jira/confirm')
  pushToJiraConfirm(
    @Param('id') id: string,
    @Body() body: { previewHash: string }
  ): Promise<JiraPushResult> {
    return this.pushToJira.confirm(id, body);
  }

  @ApiOperation({ summary: 'Check for duplicate bug reports' })
  @Post('check-duplicate')
  async checkDuplicate(
    @Body() body: CheckDuplicateInput
  ): Promise<
    CrossSourceDedupResult & {
      /** @deprecated alias for `similarReports`; will be removed once consumers update. */
      candidates: DuplicateCandidate[];
    }
  > {
    if (!body.title || body.title.trim().length < 3) {
      throw new BadRequestException('title required (min 3 chars)');
    }
    if (!body.description || body.description.trim().length < 5) {
      throw new BadRequestException('description required (min 5 chars)');
    }
    const result = await this.dedup.checkDuplicateAcrossSources(body);
    return { ...result, candidates: result.similarReports };
  }
}
