import type {
  BugReport,
  BugReportType,
  ReportSeverity,
  ReportStatus,
  Sparte,
} from '../db/schema';

export interface CreateBugReportInput {
  title: string;
  description: string;
  severity?: ReportSeverity;
  sparte?: Sparte | null;
  type?: BugReportType;
  capturedContext?: unknown;
}

export interface UpdateBugReportInput {
  title?: string;
  description?: string;
  status?: ReportStatus;
  severity?: ReportSeverity;
  sparte?: Sparte | null;
  type?: BugReportType;
  jiraIssueKey?: string | null;
}

export interface ListBugReportsFilter {
  status?: ReportStatus;
  severity?: ReportSeverity;
  sparte?: Sparte;
  type?: BugReportType;
  reporterId?: string;
}

export type BugReportRecord = BugReport & {
  reporter?: {
    id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
};
