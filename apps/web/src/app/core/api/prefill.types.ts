export type PrefillStage = 'live' | 'qa' | 'dev';

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
  expected?: string;
}

export interface ValidateRequest {
  sparte: string;
  json: string;
  stage: PrefillStage;
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
