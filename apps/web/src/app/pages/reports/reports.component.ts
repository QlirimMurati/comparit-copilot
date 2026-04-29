import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { BugReportsService } from '../../core/api/bug-reports.service';
import {
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  SPARTE_LABELS,
  SPARTEN,
  type BugReport,
  type ListBugReportsFilter,
  type ReportSeverity,
  type ReportStatus,
  type Sparte,
} from '../../core/api/bug-reports.types';

type LoadState = 'loading' | 'error' | { rows: BugReport[] };

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './reports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsComponent {
  private readonly api = inject(BugReportsService);

  protected readonly statuses = REPORT_STATUSES;
  protected readonly severities = REPORT_SEVERITIES;
  protected readonly sparten = SPARTEN;

  protected readonly filter = signal<ListBugReportsFilter>({});
  protected readonly state = signal<LoadState>('loading');

  protected readonly hasError = computed(() => this.state() === 'error');
  protected readonly rows = computed<BugReport[]>(() => {
    const s = this.state();
    return typeof s === 'object' ? s.rows : [];
  });

  protected readonly empty = computed(
    () => !this.hasError() && this.state() !== 'loading' && this.rows().length === 0
  );

  protected readonly loading = computed(() => this.state() === 'loading');

  constructor() {
    effect(() => {
      const f = this.filter();
      this.state.set('loading');
      this.api
        .list(f)
        .pipe(catchError(() => of<BugReport[] | 'error'>('error')))
        .subscribe((res) => {
          if (res === 'error') this.state.set('error');
          else this.state.set({ rows: res });
        });
    });
  }

  protected onStatusChange(value: string): void {
    this.filter.update((f) => ({
      ...f,
      status: value ? (value as ReportStatus) : undefined,
    }));
  }

  protected onSeverityChange(value: string): void {
    this.filter.update((f) => ({
      ...f,
      severity: value ? (value as ReportSeverity) : undefined,
    }));
  }

  protected onSparteChange(value: string): void {
    this.filter.update((f) => ({
      ...f,
      sparte: value ? (value as Sparte) : undefined,
    }));
  }

  protected onMineChange(checked: boolean): void {
    this.filter.update((f) => ({ ...f, mine: checked || undefined }));
  }

  protected clearFilters(): void {
    this.filter.set({});
  }

  protected get filterCount(): number {
    const f = this.filter();
    return [f.status, f.severity, f.sparte, f.mine].filter(Boolean).length;
  }

  protected sparteLabel(s: BugReport['sparte']): string {
    return s ? SPARTE_LABELS[s] : '—';
  }

  protected statusBadgeClass(s: ReportStatus): string {
    switch (s) {
      case 'new': return 'badge-new';
      case 'triaged': return 'badge-medium';
      case 'in_progress': return 'badge-progress';
      case 'resolved': return 'badge-resolved';
      case 'wontfix':
      case 'duplicate':
        return 'badge-low';
    }
  }

  protected severityBadgeClass(s: ReportSeverity): string {
    switch (s) {
      case 'blocker': return 'badge-blocker';
      case 'high': return 'badge-high';
      case 'medium': return 'badge-medium';
      case 'low': return 'badge-low';
    }
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected reporterName(r: BugReport): string {
    const reporter = r.reporter;
    if (!reporter) return '—';
    const full = [reporter.firstName, reporter.lastName]
      .map((s) => (s ?? '').trim())
      .filter((s) => s.length > 0)
      .join(' ');
    return full || reporter.name || '—';
  }
}
