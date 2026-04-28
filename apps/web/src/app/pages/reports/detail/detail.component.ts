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
  type DuplicateCandidate,
  type LocalizationCandidate,
  type LocalizationResult,
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

  protected readonly aiProposed = computed(() => this.report()?.aiProposedTicket ?? null);
  protected readonly triage = computed(() => this.report()?.aiProposedTriage ?? null);
  protected readonly clusterId = computed(() => this.report()?.clusterId ?? null);

  protected readonly localization = computed<LocalizationResult | null>(() => {
    const proposed = this.aiProposed();
    return proposed?.localization ?? this.localizationOverride();
  });
  protected readonly localizationOverride = signal<LocalizationResult | null>(null);
  protected readonly localizing = signal(false);
  protected readonly localizeError = signal<string | null>(null);

  protected readonly polishing = signal(false);
  protected readonly polishError = signal<string | null>(null);

  protected readonly duplicates = signal<DuplicateCandidate[] | null>(null);
  protected readonly duplicateChecking = signal(false);
  protected readonly duplicateError = signal<string | null>(null);

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

  protected runPolisher(): void {
    const r = this.report();
    if (!r) return;
    this.polishing.set(true);
    this.polishError.set(null);
    this.api.polish(r.id).subscribe({
      next: () => {
        this.polishing.set(false);
        this.api.getById(r.id).subscribe({
          next: (updated) => this.state.set({ kind: 'ok', report: updated }),
        });
      },
      error: (err) => {
        this.polishing.set(false);
        this.polishError.set(this.errorMessage(err, 'Polisher failed.'));
      },
    });
  }

  protected localize(): void {
    const r = this.report();
    if (!r) return;
    this.localizing.set(true);
    this.localizeError.set(null);
    this.api.localize(r.id).subscribe({
      next: (res) => {
        this.localizing.set(false);
        this.localizationOverride.set(res);
        this.api.getById(r.id).subscribe({
          next: (updated) => this.state.set({ kind: 'ok', report: updated }),
        });
      },
      error: (err) => {
        this.localizing.set(false);
        this.localizeError.set(this.errorMessage(err, 'Code localization failed.'));
      },
    });
  }

  protected confidenceTone(c: LocalizationCandidate['confidence']): string {
    switch (c) {
      case 'high':
        return 'bg-emerald-100 text-emerald-800';
      case 'medium':
        return 'bg-amber-100 text-amber-800';
      case 'low':
        return 'bg-slate-100 text-slate-700';
    }
  }

  protected formatPercent(v: number): string {
    return `${Math.round(v * 100)}%`;
  }

  protected checkDuplicates(): void {
    const r = this.report();
    if (!r) return;
    this.duplicateChecking.set(true);
    this.duplicateError.set(null);
    this.api
      .checkDuplicate({
        title: r.title,
        description: r.description,
        sparte: r.sparte,
        limit: 5,
      })
      .subscribe({
        next: (res) => {
          this.duplicateChecking.set(false);
          this.duplicates.set(res.candidates.filter((c) => c.id !== r.id));
        },
        error: (err) => {
          this.duplicateChecking.set(false);
          this.duplicateError.set(
            this.errorMessage(err, 'Duplicate check failed.')
          );
        },
      });
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected formatDistance(d: number): string {
    return d.toFixed(3);
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; message?: string };
    return e?.error?.message ?? e?.message ?? fallback;
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
