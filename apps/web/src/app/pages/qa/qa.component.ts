import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { QaService } from '../../core/api/qa.service';
import type { QaTurn } from '../../core/api/qa.types';

@Component({
  selector: 'app-qa',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './qa.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QaComponent {
  private readonly api = inject(QaService);
  private readonly fb = inject(FormBuilder);

  protected readonly sessionId = signal<string | null>(null);
  protected readonly turns = signal<QaTurn[]>([]);
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    question: ['', [Validators.required, Validators.minLength(3)]],
  });

  protected ask(): void {
    if (this.form.invalid) return;
    const q = this.form.getRawValue().question.trim();
    this.turns.update((t) => [...t, { role: 'user', text: q }]);
    this.form.reset({ question: '' });
    this.running.set(true);
    this.error.set(null);

    const sid = this.sessionId();
    this.api
      .ask({ question: q, sessionId: sid ?? undefined })
      .subscribe({
        next: (res) => {
          this.running.set(false);
          this.sessionId.set(res.sessionId);
          this.turns.update((t) => [
            ...t,
            { role: 'assistant', text: res.assistantText },
          ]);
        },
        error: (err) => {
          this.running.set(false);
          this.error.set(this.errorMessage(err, 'QA bot failed.'));
        },
      });
  }

  protected reset(): void {
    this.sessionId.set(null);
    this.turns.set([]);
    this.error.set(null);
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; message?: string };
    return e?.error?.message ?? e?.message ?? fallback;
  }
}
