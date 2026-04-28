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

export type CopilotStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_result'; toolName: string; data: unknown; isError?: boolean }
  | { type: 'done'; stopReason: string | null }
  | { type: 'error'; message: string };

// Tool result data shapes for rendering
export interface DuplicateCheckData {
  similarReports: Array<{
    id: string; title: string; status: string; severity: string;
    jiraIssueKey: string | null; distance: number;
  }>;
  similarTickets: Array<{
    jiraIssueKey: string; summary: string; status: string | null;
    issueType: string | null; distance: number;
  }>;
}

export interface JiraSearchData {
  tickets: Array<{
    jiraIssueKey: string; projectKey: string; summary: string;
    status: string | null; priority: string | null;
    issueType: string | null; assigneeName: string | null;
    assigneeEmail: string | null;
    labels: string[] | null;
    jiraUpdated: string | null;
    distance?: number;
  }>;
  mode?: 'semantic' | 'keyword' | 'filter';
}

export interface BugSubmitData {
  reportId: string;
  title: string;
  status: string;
}

export interface TranscriptData {
  sessionId: string;
  epics: Array<{
    id: string; title: string; description: string | null;
    children: Array<{
      id: string; title: string; description: string | null;
      children: Array<{ id: string; title: string; description: string | null }>;
    }>;
  }>;
  assistantText: string;
}

export interface CodeLocalizationData {
  summary: string;
  candidates: Array<{ filePath: string; symbol?: string; reason: string; confidence: number }>;
}

// Rendered message in the chat (combines streamed events into discrete items)
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolResults: Array<{ toolName: string; data: unknown }>;
  createdAt: Date;
}
