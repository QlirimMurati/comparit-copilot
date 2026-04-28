import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { UpsertValidationRule } from './validation-rules.types';
import { ValidationRulesService } from './validation-rules.service';

interface SeedEntry {
  fieldPath: string;
  label: string;
  type: string;
  validators: UpsertValidationRule['validators'];
  enumValues?: string[] | null;
  humanRule: string;
  synonyms?: string[];
}

@Injectable()
export class ValidationRulesSeeder implements OnModuleInit {
  private readonly logger = new Logger(ValidationRulesSeeder.name);

  constructor(private readonly svc: ValidationRulesService) {}

  async onModuleInit(): Promise<void> {
    const files = this.readSeedDir();
    await this.runWithFiles(files);
  }

  async runWithFiles(files: Record<string, SeedEntry[]>): Promise<void> {
    let total = 0;
    for (const [filename, entries] of Object.entries(files)) {
      const sparte = filename.replace(/\.json$/, '');
      for (const e of entries) {
        try {
          await this.svc.upsert(
            {
              sparte,
              fieldPath: e.fieldPath,
              label: e.label,
              type: e.type,
              validators: e.validators,
              enumValues: e.enumValues ?? null,
              humanRule: e.humanRule,
              synonyms: e.synonyms ?? [],
            },
            'seed',
          );
          total++;
        } catch (err) {
          this.logger.warn(
            `Skipped ${sparte}.${e.fieldPath}: ${(err as Error).message}`,
          );
        }
      }
    }
    if (total > 0) {
      this.logger.log(`Seeded ${total} validation rules from JSON`);
    }
  }

  private readSeedDir(): Record<string, SeedEntry[]> {
    // Try multiple locations. webpack-bundled `__dirname` lands in dist/apps/api,
    // so we also try the source tree (works in dev via `pnpm start:api`) and a
    // path next to a copied assets folder.
    const candidates = [
      join(__dirname, 'seed'),
      join(__dirname, 'validation-rules', 'seed'),
      join(process.cwd(), 'apps/api/src/validation-rules/seed'),
    ];
    let dir: string | null = null;
    let entries: string[] = [];
    for (const c of candidates) {
      try {
        const found = readdirSync(c).filter((f) => f.endsWith('.json'));
        if (found.length > 0) {
          dir = c;
          entries = found;
          break;
        }
      } catch {
        // try next
      }
    }
    if (!dir) {
      this.logger.warn(
        `No seed directory found; tried: ${candidates.join(', ')}`,
      );
      return {};
    }
    const out: Record<string, SeedEntry[]> = {};
    for (const f of entries) {
      try {
        const raw = readFileSync(join(dir, f), 'utf8');
        out[f] = JSON.parse(raw) as SeedEntry[];
      } catch (err) {
        this.logger.warn(
          `Failed to read ${f}: ${(err as Error).message}`,
        );
      }
    }
    return out;
  }
}
