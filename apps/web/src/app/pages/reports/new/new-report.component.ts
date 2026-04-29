import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BugReportsService } from '../../../core/api/bug-reports.service';
import {
  BUG_REPORT_TYPES,
  BUG_REPORT_TYPE_LABELS,
  REPORT_SEVERITIES,
  SPARTE_LABELS,
  SPARTEN,
  type BugReportType,
  type ReportSeverity,
  type Sparte,
} from '../../../core/api/bug-reports.types';

@Component({
  selector: 'app-new-report',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './new-report.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewReportComponent {
  private readonly api = inject(BugReportsService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly severities = REPORT_SEVERITIES;
  protected readonly sparten = SPARTEN;
  protected readonly sparteLabels = SPARTE_LABELS;
  protected readonly types = BUG_REPORT_TYPES;
  protected readonly typeLabels = BUG_REPORT_TYPE_LABELS;

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(5)]],
    description: ['', [Validators.required, Validators.minLength(10)]],
    severity: ['medium' as ReportSeverity, [Validators.required]],
    sparte: [null as Sparte | null],
    type: ['bug' as BugReportType, [Validators.required]],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set(null);

    const value = this.form.getRawValue();
    this.api.create(value).subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(['/reports']);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message ?? 'Failed to create report');
      },
    });
  }
}
