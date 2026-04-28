import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { validationRules } from '../db/schema/validation-rules';
import type {
  UpsertValidationRule,
  ValidationRule,
} from './validation-rules.types';

@Injectable()
export class ValidationRulesService {
  private readonly logger = new Logger(ValidationRulesService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async lookup(query: string, sparte?: string): Promise<ValidationRule[]> {
    const pattern = `%${query}%`;
    const sparteFilter = sparte ?? null;
    const rows = (await this.db.execute(sql`
      SELECT id, sparte, field_path AS "fieldPath", label, type, validators,
             enum_values AS "enumValues", human_rule AS "humanRule",
             synonyms, source,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM validation_rules
      WHERE (
        label ILIKE ${pattern}
        OR field_path ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM unnest(synonyms) s WHERE s ILIKE ${pattern}
        )
      )
      AND (${sparteFilter}::text IS NULL OR sparte = ${sparteFilter})
      ORDER BY sparte, field_path
      LIMIT 25
    `)) as unknown as ValidationRule[];
    return rows;
  }

  async upsert(
    input: UpsertValidationRule,
    source: 'seed' | 'manual',
  ): Promise<ValidationRule> {
    const [row] = await this.db
      .insert(validationRules)
      .values({
        sparte: input.sparte,
        fieldPath: input.fieldPath,
        label: input.label,
        type: input.type,
        validators: input.validators,
        enumValues: input.enumValues ?? null,
        humanRule: input.humanRule,
        synonyms: input.synonyms ?? [],
        source,
      })
      .onConflictDoUpdate({
        target: [validationRules.sparte, validationRules.fieldPath],
        set: {
          label: input.label,
          type: input.type,
          validators: input.validators,
          enumValues: input.enumValues ?? null,
          humanRule: input.humanRule,
          synonyms: input.synonyms ?? [],
          source,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row as ValidationRule;
  }

  async addSynonym(id: string, synonym: string): Promise<ValidationRule> {
    const trimmed = synonym.trim();
    if (!trimmed) {
      throw new Error('synonym cannot be empty');
    }

    const existing = await this.db
      .select()
      .from(validationRules)
      .where(eq(validationRules.id, id))
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundException(`Validation rule ${id} not found`);
    }
    const current = existing[0] as ValidationRule;
    const lower = trimmed.toLowerCase();
    const already = current.synonyms.some((s) => s.toLowerCase() === lower);
    const nextSynonyms = already
      ? current.synonyms
      : [...current.synonyms, trimmed];

    const [row] = await this.db
      .update(validationRules)
      .set({
        synonyms: nextSynonyms,
        source: 'manual',
        updatedAt: new Date(),
      })
      .where(eq(validationRules.id, id))
      .returning();
    return row as ValidationRule;
  }

  async list(
    filter: { sparte?: string; query?: string } = {},
  ): Promise<ValidationRule[]> {
    if (filter.query !== undefined && filter.query.length > 0) {
      return this.lookup(filter.query, filter.sparte);
    }
    if (filter.sparte) {
      const rows = await this.db
        .select()
        .from(validationRules)
        .where(eq(validationRules.sparte, filter.sparte));
      return rows as ValidationRule[];
    }
    const rows = await this.db.select().from(validationRules);
    return rows as ValidationRule[];
  }

  async getById(id: string): Promise<ValidationRule> {
    const rows = await this.db
      .select()
      .from(validationRules)
      .where(eq(validationRules.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Validation rule ${id} not found`);
    }
    return rows[0] as ValidationRule;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(validationRules).where(eq(validationRules.id, id));
  }
}
