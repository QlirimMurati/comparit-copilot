import type Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import {
  chatMessages,
  chatSessions,
  type ChatMessage,
  type ChatSession,
  type MessageRole,
  type NewChatMessage,
} from '../db/schema';
import { EMPTY_INTAKE_STATE, type IntakeState } from './intake-schema';

@Injectable()
export class ChatSessionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(input: {
    reporterEmail: string | null;
    capturedContext: unknown;
    taskId?: string | null;
  }): Promise<ChatSession> {
    const [row] = await this.db
      .insert(chatSessions)
      .values({
        kind: 'bug',
        reporterEmail: input.reporterEmail,
        capturedContext: input.capturedContext ?? null,
        intakeState: EMPTY_INTAKE_STATE,
        status: 'active',
        taskId: input.taskId ?? null,
      })
      .returning();
    return row;
  }

  async getById(id: string): Promise<ChatSession> {
    const rows = await this.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }
    return rows[0];
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt));
  }

  async appendMessage(input: {
    sessionId: string;
    role: MessageRole;
    content: Anthropic.Messages.ContentBlockParam[] | Anthropic.ContentBlock[] | string;
    stopReason?: string | null;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<ChatMessage> {
    const value: NewChatMessage = {
      sessionId: input.sessionId,
      role: input.role,
      content:
        typeof input.content === 'string'
          ? [{ type: 'text', text: input.content }]
          : input.content,
      stopReason: input.stopReason ?? null,
      inputTokens:
        input.inputTokens !== undefined ? String(input.inputTokens) : null,
      outputTokens:
        input.outputTokens !== undefined ? String(input.outputTokens) : null,
    };
    const [row] = await this.db.insert(chatMessages).values(value).returning();
    return row;
  }

  async setIntakeState(
    sessionId: string,
    state: IntakeState
  ): Promise<ChatSession> {
    const [row] = await this.db
      .update(chatSessions)
      .set({ intakeState: state, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId))
      .returning();
    return row;
  }

  async markSubmitted(
    sessionId: string,
    bugReportId: string
  ): Promise<ChatSession> {
    const [row] = await this.db
      .update(chatSessions)
      .set({
        status: 'submitted',
        bugReportId,
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, sessionId))
      .returning();
    return row;
  }
}
