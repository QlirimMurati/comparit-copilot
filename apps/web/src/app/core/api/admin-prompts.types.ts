export const PROMPT_AGENTS = [
  'intake',
  'ticket_polisher',
  'transcript_decomposer',
  'triage',
  'qa_bot',
  'code_localizer',
] as const;
export type PromptAgent = (typeof PROMPT_AGENTS)[number];

export const PROMPT_AGENT_LABELS: Record<PromptAgent, string> = {
  intake: 'Bug intake',
  ticket_polisher: 'Ticket polisher',
  transcript_decomposer: 'Transcript decomposer',
  triage: 'Triage',
  qa_bot: 'QA bot',
  code_localizer: 'Code localizer',
};

export interface PromptOverride {
  id: string;
  agent: PromptAgent;
  content: string;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptInput {
  agent: PromptAgent;
  content: string;
  isActive?: boolean;
  note?: string;
}

export interface UpdatePromptInput {
  content?: string;
  isActive?: boolean;
  note?: string;
}

export interface PromptActiveResult {
  agent: PromptAgent;
  active: string;
  default: string;
}

export interface ReplayInput {
  agent: PromptAgent;
  candidateContent: string;
  limit?: number;
}

export interface ReplayResultItem {
  sessionId: string;
  originalAssistantText: string;
  candidateAssistantText: string;
}

export interface ReplayResult {
  compared: number;
  results: ReplayResultItem[];
}
