import type { IntakeState } from './intake-schema';

export interface ChatStartInput {
  reporterEmail: string;
  capturedContext: unknown;
}

export interface ChatStartResult {
  sessionId: string;
  assistantText: string;
  intakeState: IntakeState;
  isComplete: boolean;
}

export interface ChatMessageInput {
  sessionId: string;
  text: string;
}

export interface ChatMessageResult {
  assistantText: string;
  intakeState: IntakeState;
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
