import type { IntakeState } from './intake-schema';

export interface ChatStartInput {
  reporterEmail: string;
  capturedContext: unknown;
  taskId?: string | null;
  isFromCompare?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  /** Ticket type the user picked on the widget home screen. Defaults to "bug". */
  type?: 'bug' | 'feature';
  /**
   * Raw home-picker choice. "ask" mode runs as free Q&A — agent answers
   * questions, doesn't push for ticket creation unless the user clearly
   * describes something to file.
   */
  widgetMode?: 'bug' | 'feature' | 'ask' | null;
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
  taskId?: string | null;
}

export interface ChatSubmitResult {
  bugReportId: string;
  status: string;
  createdAt: string;
}

export type IntakeStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'state'; intakeState: IntakeState; isComplete: boolean }
  | { type: 'done'; stopReason: string | null }
  | { type: 'error'; message: string };
