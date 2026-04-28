export const FEW_SHOT_AGENTS = [
  'intake',
  'ticket_polisher',
  'transcript_decomposer',
  'triage',
  'qa_bot',
  'code_localizer',
] as const;
export type FewShotAgent = (typeof FEW_SHOT_AGENTS)[number];

export const FEW_SHOT_AGENT_LABELS: Record<FewShotAgent, string> = {
  intake: 'Bug intake',
  ticket_polisher: 'Ticket polisher',
  transcript_decomposer: 'Transcript decomposer',
  triage: 'Triage',
  qa_bot: 'QA bot',
  code_localizer: 'Code localizer',
};

export interface FewShotMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface FewShotExample {
  id: string;
  agent: FewShotAgent;
  label: string;
  conversation: FewShotMessage[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFewShotInput {
  agent: FewShotAgent;
  label: string;
  conversation: FewShotMessage[];
  isActive?: boolean;
}

export interface UpdateFewShotInput {
  label?: string;
  conversation?: FewShotMessage[];
  isActive?: boolean;
}

export interface ListFewShotsResult {
  rows: FewShotExample[];
  mergedActive?: FewShotMessage[][];
}
