import type { ValidationError } from './lib/validator';

export type PrefillStage = 'live' | 'qa' | 'dev';

export interface ValidateRequest {
  sparte: string;
  json: string;
  stage?: PrefillStage;
}

export interface ValidateResponse {
  valid: boolean;
  errors: ValidationError[];
  fieldCount: number;
  cleanJson: string;
  stage: PrefillStage;
  schemaSource: 'live' | 'static';
}

export interface SparteOption {
  key: string;
  label: string;
}

export interface MissingField {
  path: string;
}

export interface ValidateForChatRequest {
  json: string;
  sparte?: string;
  stage?: PrefillStage;
}

export interface ValidateForChatResponse {
  valid: boolean;
  typeErrors: ValidationError[];
  missingRequired: MissingField[];
  fieldCount: number;
  stage: PrefillStage;
  schemaSource: 'live' | 'static';
  sparte: string;
}
