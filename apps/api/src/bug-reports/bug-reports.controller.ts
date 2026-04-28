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
  DedupService,
  type CheckDuplicateInput,
  type DuplicateCandidate,
} from '../ai/dedup.service';
import { TicketPolisherService } from '../ai/ticket-polisher.service';
import type { PolishedTicket } from '../ai/ticket-polisher.schema';
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

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class BugReportsController {
  constructor(
    private readonly reports: BugReportsService,
    private readonly polisher: TicketPolisherService,
    private readonly dedup: DedupService
  ) {}

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

  @Get(':id')
  get(@Param('id') id: string): Promise<BugReportRecord> {
    return this.reports.getById(id);
  }

  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Body() body: CreateBugReportInput
  ): Promise<BugReport> {
    if (!user) throw new BadRequestException('user context required');
    return this.reports.create(user.id, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateBugReportInput
  ): Promise<BugReport> {
    return this.reports.update(id, body);
  }

  @Post(':id/polish')
  polish(@Param('id') id: string): Promise<PolishedTicket> {
    return this.polisher.polish(id);
  }

  @Post('check-duplicate')
  async checkDuplicate(
    @Body() body: CheckDuplicateInput
  ): Promise<{ candidates: DuplicateCandidate[] }> {
    if (!body.title || body.title.trim().length < 3) {
      throw new BadRequestException('title required (min 3 chars)');
    }
    if (!body.description || body.description.trim().length < 5) {
      throw new BadRequestException('description required (min 5 chars)');
    }
    const candidates = await this.dedup.checkDuplicate(body);
    return { candidates };
  }
}
