import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

const KNOWLEDGE_DIR = path.resolve(process.cwd(), 'prompts/knowledge');

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger('KnowledgeService');
  private combined: string | null = null;

  async onModuleInit(): Promise<void> {
    try {
      const entries = await fs.readdir(KNOWLEDGE_DIR);
      const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();
      if (mdFiles.length === 0) {
        this.logger.log(`prompts/knowledge/ empty — knowledge disabled`);
        return;
      }

      const sections: string[] = [];
      for (const file of mdFiles) {
        const text = await fs.readFile(
          path.join(KNOWLEDGE_DIR, file),
          'utf8'
        );
        sections.push(text.trim());
      }
      this.combined = sections.join('\n\n---\n\n');
      this.logger.log(
        `loaded ${mdFiles.length} knowledge file(s) (${this.combined.length} chars): ${mdFiles.join(', ')}`
      );
    } catch (err) {
      this.logger.warn(
        `prompts/knowledge/ not found or unreadable — knowledge disabled (${(err as Error).message})`
      );
    }
  }

  /** Combined knowledge from all loaded MD files; null if none. */
  get(): string | null {
    return this.combined;
  }

  get isLoaded(): boolean {
    return this.combined !== null;
  }
}
