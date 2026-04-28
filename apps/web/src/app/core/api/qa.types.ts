export interface QaAskInput {
  sessionId?: string;
  question: string;
}

export interface QaAskResult {
  sessionId: string;
  assistantText: string;
}

export interface QaTurn {
  role: 'user' | 'assistant';
  text: string;
}
