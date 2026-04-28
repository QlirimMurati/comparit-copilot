import type {
  ValidationRule as ValidationRuleRow,
  ValidatorRule,
} from '../db/schema/validation-rules';

export type ValidationRule = ValidationRuleRow;
export type { ValidatorRule };

export interface UpsertValidationRule {
  sparte: string;
  fieldPath: string;
  label: string;
  type: string;
  validators: ValidatorRule[];
  enumValues?: string[] | null;
  humanRule: string;
  synonyms?: string[];
}
