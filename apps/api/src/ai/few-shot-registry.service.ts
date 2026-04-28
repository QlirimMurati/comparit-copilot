import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import {
  FEW_SHOT_AGENTS,
  fewShotExamples,
  type FewShotAgent,
  type FewShotExample,
} from '../db/schema';

export interface FewShotMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface FewShotEntry {
  source: 'file' | 'db';
  id: string;
  label: string;
  conversation: FewShotMessage[];
}

const FEW_SHOTS_ROOT = 'few-shots';

@Injectable()
export class FewShotRegistryService implements OnModuleInit {
  private readonly logger = new Logger('FewShotRegistry');
  private fileShots: Map<FewShotAgent, FewShotEntry[]> = new Map();

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    for (const agent of FEW_SHOT_AGENTS) {
      this.fileShots.set(agent, []);
    }
    await this.loadFiles();
  }

  /** Loads file-based few-shots from `<repo>/few-shots/<agent>/*.json`. */
  async loadFiles(): Promise<void> {
    const root = join(process.cwd(), FEW_SHOTS_ROOT);
    let agentDirs: string[];
    try {
      agentDirs = await fs.readdir(root);
    } catch {
      this.logger.log(
        `${FEW_SHOTS_ROOT}/ does not exist — no file-based few-shots loaded`
      );
      return;
    }

    let total = 0;
    for (const agentDir of agentDirs) {
      if (!FEW_SHOT_AGENTS.includes(agentDir as FewShotAgent)) continue;
      const agent = agentDir as FewShotAgent;
      const dir = join(root, agentDir);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }
      const entries: FewShotEntry[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(join(dir, file), 'utf8');
          const parsed = JSON.parse(raw) as {
            label?: string;
            conversation?: FewShotMessage[];
          };
          if (!Array.isArray(parsed.conversation)) continue;
          entries.push({
            source: 'file',
            id: `file:${agent}/${file}`,
            label: parsed.label ?? file.replace(/\.json$/, ''),
            conversation: parsed.conversation,
          });
        } catch (err) {
          this.logger.warn(
            `Failed to parse ${join(agentDir, file)}: ${(err as Error).message}`
          );
        }
      }
      this.fileShots.set(agent, entries);
      total += entries.length;
    }
    this.logger.log(`Loaded ${total} file-based few-shot example(s)`);
  }

  async listForAgent(agent: FewShotAgent): Promise<FewShotEntry[]> {
    const file = this.fileShots.get(agent) ?? [];
    const dbRows = await this.db
      .select()
      .from(fewShotExamples)
      .where(
        and(
          eq(fewShotExamples.agent, agent),
          eq(fewShotExamples.isActive, true)
        )
      )
      .orderBy(asc(fewShotExamples.createdAt));
    const dbEntries: FewShotEntry[] = dbRows.map((r) => ({
      source: 'db',
      id: r.id,
      label: r.label,
      conversation: r.conversation as FewShotMessage[],
    }));
    return [...file, ...dbEntries];
  }

  async listAllRowsForAdmin(
    filterAgent?: FewShotAgent
  ): Promise<FewShotExample[]> {
    return filterAgent
      ? this.db
          .select()
          .from(fewShotExamples)
          .where(eq(fewShotExamples.agent, filterAgent))
          .orderBy(asc(fewShotExamples.createdAt))
      : this.db
          .select()
          .from(fewShotExamples)
          .orderBy(asc(fewShotExamples.createdAt));
  }

  async create(input: {
    agent: FewShotAgent;
    label: string;
    conversation: FewShotMessage[];
    isActive?: boolean;
  }): Promise<FewShotExample> {
    const [row] = await this.db
      .insert(fewShotExamples)
      .values({
        agent: input.agent,
        label: input.label,
        conversation: input.conversation,
        isActive: input.isActive ?? true,
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    patch: Partial<{
      label: string;
      conversation: FewShotMessage[];
      isActive: boolean;
    }>
  ): Promise<FewShotExample | null> {
    const [row] = await this.db
      .update(fewShotExamples)
      .set({
        ...(patch.label !== undefined && { label: patch.label }),
        ...(patch.conversation !== undefined && {
          conversation: patch.conversation,
        }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(fewShotExamples.id, id))
      .returning();
    return row ?? null;
  }
}
