import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContextViewerComponent } from '@comparit-copilot/ui-kit';
import { BugReportsService } from '../../../core/api/bug-reports.service';
import {
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  SPARTEN,
  SPARTE_LABELS,
  type BugReport,
  type ReportSeverity,
  type ReportStatus,
  type Sparte,
  type UpdateBugReportInput,
} from '../../../core/api/bug-reports.types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; report: BugReport };

@Component({
  selector: 'app-report-detail',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ContextViewerComponent],
  templateUrl: './detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportDetailComponent {
  private readonly api = inject(BugReportsService);
  private readonly fb = inject(FormBuilder);

  readonly id = input.required<string>();

  protected readonly statuses = REPORT_STATUSES;
  protected readonly severities = REPORT_SEVERITIES;
  protected readonly sparten = SPARTEN;
  protected readonly sparteLabels = SPARTE_LABELS;

  protected readonly state = signal<LoadState>({ kind: 'loading' });
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saved = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    status: ['new' as ReportStatus, [Validators.required]],
    severity: ['medium' as ReportSeverity, [Validators.required]],
    sparte: [null as Sparte | null],
    jiraIssueKey: [''],
  });

  protected readonly report = computed(() => {
    const s = this.state();
    return s.kind === 'ok' ? s.report : null;
  });

  protected readonly capturedContext = computed(() => this.report()?.capturedContext ?? null);

  constructor() {
    effect(() => {
      const reportId = this.id();
      if (!reportId) return;
      this.state.set({ kind: 'loading' });
      this.api.getById(reportId).subscribe({
        next: (report) => {
          this.state.set({ kind: 'ok', report });
          this.form.reset({
            status: report.status,
            severity: report.severity,
            sparte: report.sparte,
            jiraIssueKey: report.jiraIssueKey ?? '',
          });
        },
        error: (err) => {
          const message =
            err?.status === 404
              ? 'Report not found.'
              : err?.error?.message ?? 'Failed to load report.';
          this.state.set({ kind: 'error', message });
        },
      });
    });
  }

  protected save(): void {
    const r = this.report();
    if (!r || this.form.invalid) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.saved.set(false);

    const value = this.form.getRawValue();
    const patch: UpdateBugReportInput = {
      status: value.status,
      severity: value.severity,
      sparte: value.sparte,
      jiraIssueKey: value.jiraIssueKey.trim() || null,
    };

    this.api.update(r.id, patch).subscribe({
      next: (updated) => {
        this.state.set({ kind: 'ok', report: updated });
        this.saving.set(false);
        this.saved.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.message ?? 'Failed to save changes.');
      },
    });
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
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
}
