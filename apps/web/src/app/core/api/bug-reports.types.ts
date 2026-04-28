export const REPORT_STATUSES = [
  'new',
  'triaged',
  'in_progress',
  'resolved',
  'wontfix',
  'duplicate',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_SEVERITIES = ['blocker', 'high', 'medium', 'low'] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export const SPARTEN = [
  'bu',
  'gf',
  'risikoleben',
  'kvv',
  'kvz',
  'hausrat',
  'phv',
  'wohngebaeude',
  'kfz',
  'basis_rente',
  'private_rente',
  'comparit',
] as const;
export type Sparte = (typeof SPARTEN)[number];

export const SPARTE_LABELS: Record<Sparte, string> = {
  bu: 'BU',
  gf: 'GF',
  risikoleben: 'Risikoleben',
  kvv: 'KVV',
  kvz: 'KVZ',
  hausrat: 'Hausrat',
  phv: 'PHV',
  wohngebaeude: 'Wohngebäude',
  kfz: 'KFZ',
  basis_rente: 'Basis-Rente',
  private_rente: 'Private-Rente',
  comparit: 'Comparit',
};

export const POLISHED_TICKET_TYPES = ['bug', 'task', 'story'] as const;
export type PolishedTicketType = (typeof POLISHED_TICKET_TYPES)[number];

export interface PolishedTicket {
  title: string;
  description: string;
  proposedType: PolishedTicketType;
  proposedLabels: string[];
  repro_steps: string[];
  expected: string;
  actual: string;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  status: string;
  severity: string;
  sparte: string | null;
  jiraIssueKey: string | null;
  createdAt: string;
  distance: number;
}

export type LocalizationConfidence = 'high' | 'medium' | 'low';

export interface LocalizationCandidate {
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  confidence: LocalizationConfidence;
  rationale: string;
}

export interface LocalizationResult {
  candidates: LocalizationCandidate[];
  summary: string;
  generatedAt: string;
}

export interface TriageProposalField<V> {
  value: V;
  confidence: number;
  rationale: string;
}

export interface TriageAssignee {
  userId: string | null;
  reason: string;
  confidence: number;
}

export interface TriageProposal {
  proposedSeverity: TriageProposalField<ReportSeverity>;
  proposedSparte: TriageProposalField<Sparte> | null;
  suggestedAssignee: TriageAssignee | null;
  similarReportIds: string[];
  generatedAt: string;
}

export interface CheckDuplicateInput {
  title: string;
  description: string;
  sparte?: Sparte | null;
  limit?: number;
  maxDistance?: number;
}

export interface BugReport {
  id: string;
  reporterId: string;
  title: string;
  description: string;
  status: ReportStatus;
  severity: ReportSeverity;
  sparte: Sparte | null;
  capturedContext: unknown;
  aiProposedTicket:
    | (PolishedTicket & { localization?: LocalizationResult })
    | null;
  aiProposedTriage: TriageProposal | null;
  clusterId: string | null;
  jiraIssueKey: string | null;
  createdAt: string;
  updatedAt: string;
  reporter?: { id: string; name: string; email: string };
}

export interface CreateBugReportInput {
  title: string;
  description: string;
  severity?: ReportSeverity;
  sparte?: Sparte | null;
}

export interface UpdateBugReportInput {
  title?: string;
  description?: string;
  status?: ReportStatus;
  severity?: ReportSeverity;
  sparte?: Sparte | null;
  jiraIssueKey?: string | null;
}

export interface ListBugReportsFilter {
  status?: ReportStatus;
  severity?: ReportSeverity;
  sparte?: Sparte;
  mine?: boolean;
}
