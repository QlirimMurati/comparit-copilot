import type {
  BugReport,
  ReportSeverity,
  ReportStatus,
  Sparte,
} from '../db/schema';

export interface CreateBugReportInput {
  title: string;
  description: string;
  severity?: ReportSeverity;
  sparte?: Sparte | null;
  capturedContext?: unknown;
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
  reporterId?: string;
}

export type BugReportRecord = BugReport & {
  reporter?: {
    id: string;
    name: string;
    email: string;
  };
};
