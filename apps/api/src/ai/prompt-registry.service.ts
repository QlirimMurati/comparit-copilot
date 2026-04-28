import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import {
  promptOverrides,
  type PromptAgent,
  type PromptOverride,
} from '../db/schema';

const DEFAULT_PROMPTS: Record<PromptAgent, () => Promise<string>> = {
  intake: async () => {
    const { INTAKE_SYSTEM_INSTRUCTIONS } = await import('./intake-schema');
    return INTAKE_SYSTEM_INSTRUCTIONS;
  },
  ticket_polisher: async () => {
    const { TICKET_POLISHER_SYSTEM_INSTRUCTIONS } = await import(
      './ticket-polisher.schema'
    );
    return TICKET_POLISHER_SYSTEM_INSTRUCTIONS;
  },
  transcript_decomposer: async () => '',
  triage: async () => '',
  qa_bot: async () => '',
  code_localizer: async () => '',
};

@Injectable()
export class PromptRegistryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getActiveContent(agent: PromptAgent): Promise<string> {
    const rows = await this.db
      .select()
      .from(promptOverrides)
      .where(
        and(
          eq(promptOverrides.agent, agent),
          eq(promptOverrides.isActive, true)
        )
      )
      .orderBy(desc(promptOverrides.updatedAt))
      .limit(1);
    if (rows.length > 0) return rows[0].content;
    return DEFAULT_PROMPTS[agent]();
  }

  async getDefaultContent(agent: PromptAgent): Promise<string> {
    return DEFAULT_PROMPTS[agent]();
  }

  async list(agent?: PromptAgent): Promise<PromptOverride[]> {
    return agent
      ? this.db
          .select()
          .from(promptOverrides)
          .where(eq(promptOverrides.agent, agent))
          .orderBy(asc(promptOverrides.createdAt))
      : this.db
          .select()
          .from(promptOverrides)
          .orderBy(asc(promptOverrides.createdAt));
  }

  async create(input: {
    agent: PromptAgent;
    content: string;
    isActive?: boolean;
    note?: string;
  }): Promise<PromptOverride> {
    if (input.isActive) {
      await this.deactivateOthers(input.agent);
    }
    const [row] = await this.db
      .insert(promptOverrides)
      .values({
        agent: input.agent,
        content: input.content,
        isActive: input.isActive ?? false,
        note: input.note ?? null,
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    patch: Partial<{ content: string; isActive: boolean; note: string }>
  ): Promise<PromptOverride | null> {
    if (patch.isActive === true) {
      const existing = await this.db
        .select()
        .from(promptOverrides)
        .where(eq(promptOverrides.id, id))
        .limit(1);
      if (existing.length > 0) {
        await this.deactivateOthers(existing[0].agent, id);
      }
    }
    const [row] = await this.db
      .update(promptOverrides)
      .set({
        ...(patch.content !== undefined && { content: patch.content }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        ...(patch.note !== undefined && { note: patch.note }),
        updatedAt: new Date(),
      })
      .where(eq(promptOverrides.id, id))
      .returning();
    return row ?? null;
  }

  private async deactivateOthers(
    agent: PromptAgent,
    exceptId?: string
  ): Promise<void> {
    await this.db
      .update(promptOverrides)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(promptOverrides.agent, agent),
          eq(promptOverrides.isActive, true)
        )
      );
    if (exceptId) {
      await this.db
        .update(promptOverrides)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(promptOverrides.id, exceptId));
    }
  }
}
