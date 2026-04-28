export type WidgetSeverity = 'blocker' | 'high' | 'medium' | 'low';

export type WidgetSparte =
  | 'bu'
  | 'gf'
  | 'risikoleben'
  | 'kvv'
  | 'kvz'
  | 'hausrat'
  | 'phv'
  | 'wohngebaeude'
  | 'kfz'
  | 'basis_rente'
  | 'private_rente'
  | 'comparit';

export interface CapturedContext {
  url: string;
  pathname: string;
  search: string;
  hash: string;
  ids: Record<string, string>;
  sparte: WidgetSparte | null;
  appVersion: string | null;
  userAgent: string;
  viewport: { width: number; height: number };
  timezone: string;
  locale: string;
  timestamp: string;
  referrer: string;
  reporterEmail: string | null;
}

export interface WidgetReportInput {
  title: string;
  description: string;
  severity: WidgetSeverity;
  reporterEmail: string;
  sparte?: WidgetSparte | null;
  capturedContext?: CapturedContext;
}

export interface WidgetReportResult {
  id: string;
  status: string;
  createdAt: string;
}

export interface WidgetApiConfig {
  apiBase: string;
  basicUser: string;
  basicPass: string;
}

export interface WidgetIntakeState {
  title?: string;
  description?: string;
  severity?: WidgetSeverity;
  sparte?: WidgetSparte;
  isComplete?: boolean;
}

export interface ChatStartInput {
  reporterEmail: string;
  capturedContext: CapturedContext;
}

export interface ChatStartResult {
  sessionId: string;
  assistantText: string;
  intakeState: WidgetIntakeState;
  isComplete: boolean;
}

export interface ChatMessageInput {
  sessionId: string;
  text: string;
}

export interface ChatMessageResult {
  assistantText: string;
  intakeState: WidgetIntakeState;
  isComplete: boolean;
}

export interface ChatSubmitInput {
  sessionId: string;
}

export interface ChatSubmitResult {
  bugReportId: string;
  status: string;
  createdAt: string;
}
