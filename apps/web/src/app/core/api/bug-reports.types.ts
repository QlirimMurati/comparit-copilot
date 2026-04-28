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

export interface BugReport {
  id: string;
  reporterId: string;
  title: string;
  description: string;
  status: ReportStatus;
  severity: ReportSeverity;
  sparte: Sparte | null;
  capturedContext: unknown;
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
