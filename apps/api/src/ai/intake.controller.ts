import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBasicAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DRIZZLE, type Database } from '../db/db.module';
import { bugReports } from '../db/schema';
import { findOrCreateReporter } from '../users/find-or-create-reporter';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ChatSessionService } from './chat-session.service';
import { EmbedQueueService } from './embed.queue';
import { IntakeAgentService } from './intake-agent.service';
import { isIntakeReady, type IntakeState } from './intake-schema';
import { TriageQueueService } from './triage.queue';
import type {
  ChatMessageInput,
  ChatMessageResult,
  ChatStartInput,
  ChatStartResult,
  ChatSubmitInput,
  ChatSubmitResult,
  IntakeStreamEvent,
} from './intake.types';

@ApiTags('widget-chat')
@ApiBasicAuth('widget-basic')
@Controller('widget/chat')
export class IntakeController {
  private readonly logger = new Logger('IntakeController');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sessions: ChatSessionService,
    private readonly agent: IntakeAgentService,
    private readonly embedQueue: EmbedQueueService,
    private readonly triageQueue: TriageQueueService,
    private readonly realtime: RealtimeGateway
  ) {}

  @ApiOperation({
    summary: 'Start a new AI bug-intake chat session',
    description:
      'Creates a session and runs the first agent turn. Returns the assistant greeting + initial intake state.',
  })
  @Post('start')
  async start(@Body() body: ChatStartInput): Promise<ChatStartResult> {
    if (!body.reporterEmail) {
      throw new BadRequestException('reporterEmail required');
    }
    const baseContext =
      body.capturedContext && typeof body.capturedContext === 'object'
        ? (body.capturedContext as Record<string, unknown>)
        : {};
    const capturedContext = {
      ...baseContext,
      isFromCompare: body.isFromCompare === true,
      reporterFirstName: body.firstName ?? null,
      reporterLastName: body.lastName ?? null,
    };
    const session = await this.sessions.create({
      reporterEmail: body.reporterEmail,
      capturedContext,
      taskId: body.taskId ?? null,
    });
    const result = await this.runTurnSafely({ sessionId: session.id });
    return {
      sessionId: session.id,
      assistantText: result.assistantText,
      intakeState: result.intakeState,
      isComplete: result.isComplete,
    };
  }

  @ApiOperation({
    summary: 'Send a user message to the intake agent',
    description: 'Runs one agent turn against the existing session.',
  })
  @Post('message')
  async message(@Body() body: ChatMessageInput): Promise<ChatMessageResult> {
    if (!body.sessionId) throw new BadRequestException('sessionId required');
    const text = body.text?.trim();
    if (!text) throw new BadRequestException('text required');
    const result = await this.runTurnSafely({
      sessionId: body.sessionId,
      userText: text,
    });
    return {
      assistantText: result.assistantText,
      intakeState: result.intakeState,
      isComplete: result.isComplete,
    };
  }

  @ApiOperation({
    summary: 'Stream an intake agent turn as Server-Sent Events',
    description: 'Same as /message but streams partial tokens + state events.',
  })
  @Post('message/stream')
  async messageStream(
    @Body() body: ChatMessageInput,
    @Res() res: Response
  ): Promise<void> {
    if (!body.sessionId) throw new BadRequestException('sessionId required');
    const text = body.text?.trim();
    if (!text) throw new BadRequestException('text required');

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeEvent = (event: IntakeStreamEvent): void => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.agent.runTurnStream({
        sessionId: body.sessionId,
        userText: text,
      })) {
        writeEvent(event);
      }
    } catch (err) {
      this.logger.error(
        `agent.runTurnStream failed: ${(err as Error).message}`,
        (err as Error).stack
      );
      writeEvent({ type: 'error', message: (err as Error).message });
    } finally {
      res.end();
    }
  }

  @ApiOperation({
    summary: 'Finalize the intake and create a bug report',
    description:
      'Requires `isComplete` intake state (title, description, severity). Marks session as `submitted`.',
  })
  @Post('submit')
  async submit(@Body() body: ChatSubmitInput): Promise<ChatSubmitResult> {
    if (!body.sessionId) throw new BadRequestException('sessionId required');

    const session = await this.sessions.getById(body.sessionId);
    if (session.status === 'submitted') {
      throw new BadRequestException('session already submitted');
    }
    const intake = (session.intakeState as IntakeState | null) ?? {
      isComplete: false,
    };
    if (!isIntakeReady(intake)) {
      throw new BadRequestException(
        'intake incomplete — title, description, and severity required'
      );
    }
    if (!session.reporterEmail) {
      throw new BadRequestException('session has no reporterEmail');
    }

    const sessionContext =
      (session.capturedContext as Record<string, unknown> | null) ?? {};
    const reporterFirstName =
      typeof sessionContext['reporterFirstName'] === 'string'
        ? (sessionContext['reporterFirstName'] as string)
        : null;
    const reporterLastName =
      typeof sessionContext['reporterLastName'] === 'string'
        ? (sessionContext['reporterLastName'] as string)
        : null;

    const reporterId = await findOrCreateReporter(
      this.db,
      session.reporterEmail,
      { firstName: reporterFirstName, lastName: reporterLastName }
    );

    const transcript = await this.sessions.listMessages(session.id);
    const capturedContext = sessionContext;
    const reportContext = {
      ...capturedContext,
      chatSessionId: session.id,
      transcriptMessageCount: transcript.length,
    };

    const sparteFromContext =
      typeof capturedContext['sparte'] === 'string'
        ? (capturedContext['sparte'] as string)
        : null;

    const taskId = body.taskId ?? session.taskId ?? null;

    const [row] = await this.db
      .insert(bugReports)
      .values({
        reporterId,
        title: intake.title!.trim(),
        description: intake.description!.trim(),
        severity: intake.severity ?? 'medium',
        sparte: (intake.sparte ?? sparteFromContext) as
          | (typeof bugReports)['sparte']['_']['data']
          | null,
        capturedContext: reportContext,
        taskId,
      })
      .returning({
        id: bugReports.id,
        status: bugReports.status,
        createdAt: bugReports.createdAt,
      });

    await this.sessions.markSubmitted(session.id, row.id);
    await this.embedQueue.enqueueReportEmbedding(row.id);
    await this.triageQueue.enqueueReportTriage(row.id);
    this.realtime.emitBugReportCreated({
      reportId: row.id,
      reporterId,
      status: row.status,
      severity: intake.severity ?? 'medium',
      sparte: (intake.sparte ?? sparteFromContext) ?? null,
    });

    return {
      bugReportId: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async runTurnSafely(input: {
    sessionId: string;
    userText?: string;
  }) {
    try {
      return await this.agent.runTurn(input);
    } catch (err) {
      this.logger.error(
        `agent.runTurn failed: ${(err as Error).message}`,
        (err as Error).stack
      );
      throw new HttpException(
        `AI request failed: ${(err as Error).message}`,
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}
