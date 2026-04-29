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
import {
  AttachmentsService,
  type AttachmentMetadata,
} from '../../../core/api/attachments.service';
import { BugReportsService } from '../../../core/api/bug-reports.service';
import { CopilotService } from '../../../core/api/copilot.service';
import { AuthImageDirective } from '../../../shared/auth-image.directive';
import type {
  JiraPushPreview,
  JiraPushResult,
} from '../../../core/api/copilot.types';
import {
  BUG_REPORT_TYPES,
  BUG_REPORT_TYPE_LABELS,
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  SPARTEN,
  SPARTE_LABELS,
  type BugReport,
  type BugReportType,
  type DuplicateCandidate,
  type LocalizationCandidate,
  type LocalizationResult,
  type ReportSeverity,
  type ReportStatus,
  type Sparte,
  type UpdateBugReportInput,
} from '../../../core/api/bug-reports.types';

type JiraPushFlowState =
  | { stage: 'idle' }
  | { stage: 'previewing' }
  | { stage: 'preview'; preview: JiraPushPreview }
  | { stage: 'confirming'; preview: JiraPushPreview }
  | { stage: 'pushed'; result: JiraPushResult }
  | { stage: 'error'; message: string };

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; report: BugReport };

@Component({
  selector: 'app-report-detail',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ContextViewerComponent,
    AuthImageDirective,
  ],
  templateUrl: './detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportDetailComponent {
  private readonly api = inject(BugReportsService);
  private readonly copilotApi = inject(CopilotService);
  private readonly attachmentsApi = inject(AttachmentsService);
  private readonly fb = inject(FormBuilder);

  protected readonly attachments = signal<AttachmentMetadata[]>([]);
  protected readonly attachmentUrl = (id: string) =>
    this.attachmentsApi.bytesUrl(id);

  readonly id = input.required<string>();

  protected readonly statuses = REPORT_STATUSES;
  protected readonly statusLabels = REPORT_STATUS_LABELS;
  protected readonly severities = REPORT_SEVERITIES;
  protected readonly sparten = SPARTEN;
  protected readonly sparteLabels = SPARTE_LABELS;
  protected readonly types = BUG_REPORT_TYPES;
  protected readonly typeLabels = BUG_REPORT_TYPE_LABELS;

  protected readonly state = signal<LoadState>({ kind: 'loading' });
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saved = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    status: ['new' as ReportStatus, [Validators.required]],
    severity: ['medium' as ReportSeverity, [Validators.required]],
    sparte: [null as Sparte | null],
    type: ['bug' as BugReportType, [Validators.required]],
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

  protected readonly jiraPush = signal<JiraPushFlowState>({ stage: 'idle' });

  constructor() {
    effect(() => {
      const reportId = this.id();
      if (!reportId) return;
      this.state.set({ kind: 'loading' });
      this.attachments.set([]);
      this.api.getById(reportId).subscribe({
        next: (report) => {
          this.state.set({ kind: 'ok', report });
          this.form.reset({
            status: report.status,
            severity: report.severity,
            sparte: report.sparte,
            type: report.type ?? 'bug',
          });
          this.attachmentsApi.listForReport(reportId).subscribe({
            next: (list) => this.attachments.set(list),
            error: () => this.attachments.set([]),
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
      type: value.type,
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

  protected confidenceBadgeClass(c: LocalizationCandidate['confidence']): string {
    switch (c) {
      case 'high': return 'badge-resolved';
      case 'medium': return 'badge-medium';
      case 'low': return 'badge-low';
    }
  }
  protected confidencePct(c: LocalizationCandidate['confidence']): number {
    switch (c) {
      case 'high': return 90;
      case 'medium': return 60;
      case 'low': return 30;
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

  protected reporterName(r: BugReport): string {
    const reporter = r.reporter;
    if (!reporter) return '—';
    const full = [reporter.firstName, reporter.lastName]
      .map((s) => (s ?? '').trim())
      .filter((s) => s.length > 0)
      .join(' ');
    return full || reporter.name || '—';
  }

  protected formatDistance(d: number): string {
    return d.toFixed(3);
  }

  protected startJiraPush(): void {
    const r = this.report();
    if (!r) return;
    this.jiraPush.set({ stage: 'previewing' });
    this.copilotApi.previewJiraPush(r.id).subscribe({
      next: (preview) => this.jiraPush.set({ stage: 'preview', preview }),
      error: (err) =>
        this.jiraPush.set({
          stage: 'error',
          message: this.errorMessage(err, 'Preview failed.'),
        }),
    });
  }

  protected confirmJiraPush(preview: JiraPushPreview): void {
    const r = this.report();
    if (!r) return;
    this.jiraPush.set({ stage: 'confirming', preview });
    this.copilotApi.confirmJiraPush(r.id, preview.previewHash).subscribe({
      next: (result) => {
        this.jiraPush.set({ stage: 'pushed', result });
        // Refresh the report so jiraIssueKey shows on the page
        this.api.getById(r.id).subscribe({
          next: (updated) => this.state.set({ kind: 'ok', report: updated }),
        });
      },
      error: (err) =>
        this.jiraPush.set({
          stage: 'error',
          message: this.errorMessage(err, 'Confirm failed.'),
        }),
    });
  }

  protected cancelJiraPush(): void {
    this.jiraPush.set({ stage: 'idle' });
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; message?: string };
    return e?.error?.message ?? e?.message ?? fallback;
  }

  protected statusBadgeClass(s: ReportStatus): string {
    switch (s) {
      case 'new': return 'badge-new';
      case 'ticket_created': return 'badge-resolved';
      case 'duplicate': return 'badge-low';
      case 'declined': return 'badge-blocker';
    }
  }

  protected statusLabel(s: ReportStatus | string): string {
    return REPORT_STATUS_LABELS[s as ReportStatus] ?? String(s);
  }

  protected severityBadgeClass(s: ReportSeverity): string {
    switch (s) {
      case 'blocker': return 'badge-blocker';
      case 'high': return 'badge-high';
      case 'medium': return 'badge-medium';
      case 'low': return 'badge-low';
    }
  }
}
