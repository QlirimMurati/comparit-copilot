import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminDigestsService } from '../../../core/api/admin-digests.service';
import type { DigestResult } from '../../../core/api/admin-digests.types';

@Component({
  selector: 'app-admin-digests',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './digests.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DigestsComponent {
  private readonly api = inject(AdminDigestsService);
  private readonly fb = inject(FormBuilder);

  protected readonly digest = signal<DigestResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notFound = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    date: [
      this.todayIso(),
      [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)],
    ],
  });

  protected fetch(): void {
    if (this.form.invalid) return;
    const date = this.form.getRawValue().date;
    this.loading.set(true);
    this.notFound.set(false);
    this.error.set(null);
    this.api.get(date).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.digest.set(res);
      },
      error: (err) => {
        this.loading.set(false);
        this.digest.set(null);
        if (err?.status === 404) {
          this.notFound.set(true);
        } else {
          this.error.set(this.errorMessage(err, 'Failed to fetch digest.'));
        }
      },
    });
  }

  protected run(): void {
    if (this.form.invalid) return;
    const date = this.form.getRawValue().date;
    this.running.set(true);
    this.notFound.set(false);
    this.error.set(null);
    this.api.run(date).subscribe({
      next: (res) => {
        this.running.set(false);
        this.digest.set(res);
      },
      error: (err) => {
        this.running.set(false);
        this.error.set(this.errorMessage(err, 'Digest generation failed.'));
      },
    });
  }

  private todayIso(): string {
    const d = new Date();
    const pad = (n: number) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; message?: string };
    return e?.error?.message ?? e?.message ?? fallback;
  }
}
