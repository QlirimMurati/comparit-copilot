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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DigestService, type DigestResult } from './digest.service';

interface RunDigestInput {
  date: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'qa_lead')
@Controller('admin/digests')
export class AdminDigestsController {
  constructor(private readonly digests: DigestService) {}

  @Get(':date')
  async get(@Param('date') date: string): Promise<DigestResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const existing = await this.digests.readForDate(date);
    if (existing) return existing;
    throw new NotFoundException(
      `No digest found for ${date} — POST /api/admin/digests/run to generate`
    );
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  run(@Body() body: RunDigestInput): Promise<DigestResult> {
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    return this.digests.generateForDate(body.date);
  }
}
