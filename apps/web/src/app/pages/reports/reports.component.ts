import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { BugReportsService } from '../../core/api/bug-reports.service';
import {
  type BugReport,
  type ReportSeverity,
  type ReportStatus,
  SPARTE_LABELS,
} from '../../core/api/bug-reports.types';

@Component({
  selector: 'app-reports',
  imports: [RouterLink],
  templateUrl: './reports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsComponent {
  private readonly api = inject(BugReportsService);

  protected readonly reports = toSignal(
    this.api.list().pipe(catchError(() => of<BugReport[] | 'error'>('error'))),
    { initialValue: [] as BugReport[] | 'error' }
  );

  protected readonly hasError = computed(() => this.reports() === 'error');
  protected readonly rows = computed<BugReport[]>(() => {
    const r = this.reports();
    return r === 'error' || !r ? [] : r;
  });

  protected readonly empty = computed(
    () => !this.hasError() && this.rows().length === 0
  );

  protected sparteLabel(s: BugReport['sparte']): string {
    return s ? SPARTE_LABELS[s] : '—';
  }

  protected statusTone(s: ReportStatus): string {
    switch (s) {
      case 'new':
        return 'bg-sky-100 text-sky-800';
      case 'triaged':
        return 'bg-amber-100 text-amber-800';
      case 'in_progress':
        return 'bg-indigo-100 text-indigo-800';
      case 'resolved':
        return 'bg-emerald-100 text-emerald-800';
      case 'wontfix':
      case 'duplicate':
        return 'bg-slate-200 text-slate-700';
    }
  }

  protected severityTone(s: ReportSeverity): string {
    switch (s) {
      case 'blocker':
        return 'bg-rose-100 text-rose-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
        return 'bg-amber-100 text-amber-800';
      case 'low':
        return 'bg-slate-100 text-slate-700';
    }
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
