import type Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/db.module';
import { copilotMessages, copilotSessions } from '../../db/schema';
import type { CopilotSession, CopilotMessage } from '../../db/schema';
import type { CopilotState } from './copilot.types';

@Injectable()
export class CopilotSessionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(userId: string): Promise<CopilotSession> {
    const [row] = await this.db
      .insert(copilotSessions)
      .values({ userId, state: {} })
      .returning();
    return row;
  }

  async getById(id: string): Promise<CopilotSession> {
    const rows = await this.db
      .select()
      .from(copilotSessions)
      .where(eq(copilotSessions.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException(`Copilot session ${id} not found`);
    return rows[0];
  }

  async listForUser(userId: string): Promise<CopilotSession[]> {
    return this.db
      .select()
      .from(copilotSessions)
      .where(eq(copilotSessions.userId, userId))
      .orderBy(desc(copilotSessions.updatedAt))
      .limit(50);
  }

  async setState(id: string, state: CopilotState): Promise<void> {
    await this.db
      .update(copilotSessions)
      .set({ state, updatedAt: new Date() })
      .where(eq(copilotSessions.id, id));
  }

  async setTitle(id: string, title: string): Promise<void> {
    await this.db
      .update(copilotSessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(copilotSessions.id, id));
  }

  async listMessages(sessionId: string): Promise<CopilotMessage[]> {
    return this.db
      .select()
      .from(copilotMessages)
      .where(eq(copilotMessages.sessionId, sessionId))
      .orderBy(asc(copilotMessages.createdAt));
  }

  async appendMessage(input: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: Anthropic.Messages.ContentBlockParam[] | Anthropic.ContentBlock[] | string;
    stopReason?: string | null;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<CopilotMessage> {
    const [row] = await this.db
      .insert(copilotMessages)
      .values({
        sessionId: input.sessionId,
        role: input.role,
        content: typeof input.content === 'string'
          ? [{ type: 'text', text: input.content }]
          : input.content,
        stopReason: input.stopReason ?? null,
        inputTokens: input.inputTokens !== undefined ? String(input.inputTokens) : null,
        outputTokens: input.outputTokens !== undefined ? String(input.outputTokens) : null,
      })
      .returning();
    return row;
  }
}
