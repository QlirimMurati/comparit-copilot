export interface CopilotBugDraft {
  title?: string;
  description?: string;
  severity?: 'blocker' | 'high' | 'medium' | 'low';
  sparte?: string;
  type?: 'bug' | 'feature';
  /**
   * Optional metadata gathered together at the end of the conversation
   * before submission (one batched ask, not field-by-field).
   * antragId is required when the bug is in the Antrag flow.
   */
  kundeId?: string;
  antragId?: string;
  taskId?: string;
  /** True once the agent has run the consolidated optional-metadata ask. */
  optionalMetadataAsked?: boolean;
}

export interface CopilotState {
  bugDraft?: CopilotBugDraft;
  lastBugReportId?: string;
  lastTranscriptId?: string;
  prefillStage?: 'live' | 'qa' | 'dev';
}

export type CopilotStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_result'; toolName: string; data: unknown; isError?: boolean }
  | { type: 'done'; stopReason: string | null }
  | { type: 'error'; message: string };

export interface CopilotStartResult {
  sessionId: string;
  title: string | null;
}

export interface CopilotSessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolResults?: { toolName: string; data: unknown }[];
  createdAt: string;
}
