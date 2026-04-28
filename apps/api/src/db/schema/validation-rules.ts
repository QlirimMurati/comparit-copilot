import { sql } from 'drizzle-orm';
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export interface ValidatorRule {
  kind:
    | 'required'
    | 'min'
    | 'max'
    | 'minLength'
    | 'maxLength'
    | 'pattern'
    | 'minDate'
    | 'maxDate'
    | 'minAge'
    | 'maxAge'
    | 'custom';
  value?: string | number;
  message?: string;
}

export const validationRules = pgTable(
  'validation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sparte: text('sparte').notNull(),
    fieldPath: text('field_path').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    validators: jsonb('validators').notNull().$type<ValidatorRule[]>(),
    enumValues: text('enum_values').array(),
    humanRule: text('human_rule').notNull(),
    synonyms: text('synonyms')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    source: text('source').notNull().default('seed'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sparteFieldUq: uniqueIndex('validation_rules_sparte_field_uq').on(
      table.sparte,
      table.fieldPath,
    ),
  }),
);

export type ValidationRule = typeof validationRules.$inferSelect;
export type NewValidationRule = typeof validationRules.$inferInsert;
