export type TranscriptNodeType = 'epic' | 'story' | 'subtask';
export type TranscriptStatus = 'active' | 'complete' | 'abandoned';

export interface TranscriptSessionRecord {
  id: string;
  title: string | null;
  rawTranscript: string;
  status: TranscriptStatus;
  instructions: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptTreeNode {
  id: string;
  parentId: string | null;
  nodeType: TranscriptNodeType;
  title: string;
  description: string | null;
  labels: string[];
  estimateHours: number | null;
  sortOrder: number;
  children: TranscriptTreeNode[];
}

export interface TranscriptTreeResult {
  session: TranscriptSessionRecord;
  epics: TranscriptTreeNode[];
  assistantText: string;
  isComplete: boolean;
}

export interface StartTranscriptInput {
  rawTranscript: string;
  title?: string;
}

export interface RefineTranscriptInput {
  instruction: string;
}
