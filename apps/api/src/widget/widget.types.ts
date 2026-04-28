import type { ReportSeverity, Sparte } from '../db/schema';

export interface WidgetReportInput {
  title: string;
  description: string;
  severity?: ReportSeverity;
  sparte?: Sparte | null;
  reporterEmail: string;
  capturedContext?: unknown;
}

export interface WidgetReportResult {
  id: string;
  status: string;
  createdAt: string;
}
