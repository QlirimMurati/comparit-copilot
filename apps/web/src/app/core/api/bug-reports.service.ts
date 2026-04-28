import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  BugReport,
  CheckDuplicateInput,
  CreateBugReportInput,
  DuplicateCandidate,
  ListBugReportsFilter,
  LocalizationResult,
  PolishedTicket,
  UpdateBugReportInput,
} from './bug-reports.types';

@Injectable({ providedIn: 'root' })
export class BugReportsService {
  private readonly http = inject(HttpClient);

  list(filter: ListBugReportsFilter = {}): Observable<BugReport[]> {
    let params = new HttpParams();
    if (filter.status) params = params.set('status', filter.status);
    if (filter.severity) params = params.set('severity', filter.severity);
    if (filter.sparte) params = params.set('sparte', filter.sparte);
    if (filter.mine) params = params.set('mine', 'true');
    return this.http.get<BugReport[]>('/api/reports', { params });
  }

  getById(id: string): Observable<BugReport> {
    return this.http.get<BugReport>(`/api/reports/${id}`);
  }

  create(input: CreateBugReportInput): Observable<BugReport> {
    return this.http.post<BugReport>('/api/reports', input);
  }

  update(id: string, patch: UpdateBugReportInput): Observable<BugReport> {
    return this.http.patch<BugReport>(`/api/reports/${id}`, patch);
  }

  polish(id: string): Observable<PolishedTicket> {
    return this.http.post<PolishedTicket>(`/api/reports/${id}/polish`, {});
  }

  localize(id: string): Observable<LocalizationResult> {
    return this.http.post<LocalizationResult>(
      `/api/reports/${id}/localize`,
      {}
    );
  }

  checkDuplicate(
    input: CheckDuplicateInput
  ): Observable<{ candidates: DuplicateCandidate[] }> {
    return this.http.post<{ candidates: DuplicateCandidate[] }>(
      '/api/reports/check-duplicate',
      input
    );
  }
}
