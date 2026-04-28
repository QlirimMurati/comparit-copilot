import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { QaBotService, type QaAskResult } from './qa-bot.service';

interface AskInput {
  sessionId?: string;
  question: string;
}

@UseGuards(JwtAuthGuard)
@Controller('qa')
export class QaController {
  constructor(private readonly bot: QaBotService) {}

  @Post('ask')
  async ask(@Body() body: AskInput): Promise<QaAskResult> {
    if (!body.question || body.question.trim().length < 3) {
      throw new BadRequestException('question required (min 3 chars)');
    }
    return this.bot.ask({
      sessionId: body.sessionId,
      question: body.question,
    });
  }
}
