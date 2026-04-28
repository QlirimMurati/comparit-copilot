import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { CopilotAgentService } from './copilot-agent.service';
import { CopilotSessionService } from './copilot-session.service';
import { extractStageDirective } from './stage-directive';
import type { CopilotState, CopilotStreamEvent, CopilotMessageRecord, CopilotSessionSummary } from './copilot.types';

interface AuthRequest extends Request {
  user: { id: string; email: string; name: string; role: string };
}

@ApiTags('copilot')
@UseGuards(JwtAuthGuard)
@Controller('copilot')
export class CopilotController {
  private readonly logger = new Logger('CopilotController');

  constructor(
    private readonly agent: CopilotAgentService,
    private readonly sessions: CopilotSessionService
  ) {}

  @ApiOperation({ summary: 'Start a new copilot session' })
  @Post('sessions')
  async createSession(@Req() req: AuthRequest) {
    const session = await this.sessions.create(req.user.id);
    return { sessionId: session.id, title: session.title };
  }

  @ApiOperation({ summary: 'List copilot sessions for the current user' })
  @Get('sessions')
  async listSessions(@Req() req: AuthRequest): Promise<CopilotSessionSummary[]> {
    const rows = await this.sessions.listForUser(req.user.id);
    return rows.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  @ApiOperation({ summary: 'Load message history for a session' })
  @Get('sessions/:id/messages')
  async getMessages(
    @Param('id') id: string,
    @Req() req: AuthRequest
  ): Promise<CopilotMessageRecord[]> {
    const session = await this.sessions.getById(id);
    if (session.userId !== req.user.id) {
      throw new BadRequestException('Session not found');
    }
    const messages = await this.sessions.listMessages(id);
    const result: CopilotMessageRecord[] = [];
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const blocks = m.content as Array<{ type: string; text?: string; name?: string; content?: unknown }>;
      if (!Array.isArray(blocks)) continue;
      const textBlocks = blocks.filter((b) => b.type === 'text' && b.text);
      const text = textBlocks.map((b) => b.text).join('');
      if (!text) continue;
      result.push({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        text,
        createdAt: m.createdAt.toISOString(),
      });
    }
    return result;
  }

  @ApiOperation({ summary: 'Send a message and stream the response as SSE' })
  @Post('sessions/:id/message')
  async message(
    @Param('id') id: string,
    @Body() body: { text: string },
    @Req() req: AuthRequest,
    @Res() res: Response
  ): Promise<void> {
    if (!body.text?.trim()) throw new BadRequestException('text required');

    const session = await this.sessions.getById(id);
    if (session.userId !== req.user.id) {
      throw new BadRequestException('Session not found');
    }

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (event: CopilotStreamEvent): void => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const userText = body.text.trim();
    const { stage: directiveStage, cleanedText } = extractStageDirective(userText);

    if (directiveStage) {
      const currentState = (session.state as CopilotState | null) ?? {};
      await this.sessions.setState(id, {
        ...currentState,
        prefillStage: directiveStage,
      });
    }

    if (directiveStage && cleanedText.length === 0) {
      const ackText = `Stage set to ${directiveStage.toUpperCase()}. Paste prefill JSON to validate.`;
      await this.sessions.appendMessage({
        sessionId: id,
        role: 'user',
        content: userText,
      });
      await this.sessions.appendMessage({
        sessionId: id,
        role: 'assistant',
        content: [{ type: 'text', text: ackText }],
      });
      write({ type: 'text_delta', text: ackText });
      write({ type: 'done', stopReason: 'stage_directive' });
      res.end();
      return;
    }

    try {
      for await (const event of this.agent.runStream({
        sessionId: id,
        userId: req.user.id,
        userEmail: req.user.email,
        userText: cleanedText.length > 0 ? cleanedText : userText,
      })) {
        write(event);
      }
    } catch (err) {
      this.logger.error(`runStream failed: ${(err as Error).message}`, (err as Error).stack);
      write({ type: 'error', message: (err as Error).message });
    } finally {
      res.end();
    }
  }
}
