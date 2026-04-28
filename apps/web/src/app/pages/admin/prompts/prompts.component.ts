import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { AdminPromptsService } from '../../../core/api/admin-prompts.service';
import {
  PROMPT_AGENTS,
  PROMPT_AGENT_LABELS,
  type PromptActiveResult,
  type PromptAgent,
  type PromptOverride,
  type ReplayResult,
} from '../../../core/api/admin-prompts.types';

@Component({
  selector: 'app-admin-prompts',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './prompts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptsComponent {
  private readonly api = inject(AdminPromptsService);
  private readonly fb = inject(FormBuilder);

  protected readonly agents = PROMPT_AGENTS;
  protected readonly agentLabels = PROMPT_AGENT_LABELS;

  protected readonly selectedAgent = signal<PromptAgent>('intake');
  protected readonly rows = signal<PromptOverride[]>([]);
  protected readonly active = signal<PromptActiveResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly listError = signal<string | null>(null);

  protected readonly editingId = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly replayOpen = signal(false);
  protected readonly replayCandidate = signal('');
  protected readonly replayResult = signal<ReplayResult | null>(null);
  protected readonly replayRunning = signal(false);
  protected readonly replayError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    content: ['', [Validators.required, Validators.minLength(10)]],
    note: [''],
    isActive: [false],
  });

  protected readonly empty = computed(
    () => !this.loading() && !this.listError() && this.rows().length === 0
  );

  constructor() {
    effect(() => {
      const agent = this.selectedAgent();
      this.refresh(agent);
    });
  }

  protected onAgentChange(value: string): void {
    if ((PROMPT_AGENTS as readonly string[]).includes(value)) {
      this.selectedAgent.set(value as PromptAgent);
      this.cancelEdit();
      this.replayOpen.set(false);
      this.replayResult.set(null);
    }
  }

  protected refresh(agent: PromptAgent): void {
    this.loading.set(true);
    this.listError.set(null);
    this.api
      .list(agent)
      .pipe(catchError((err) => of({ rows: [], _error: err })))
      .subscribe((res) => {
        this.loading.set(false);
        if ('_error' in res) {
          this.listError.set(this.errorMessage(res['_error'], 'Failed to load prompts.'));
          this.rows.set([]);
        } else {
          this.rows.set(res.rows);
        }
      });
    this.api
      .getActive(agent)
      .pipe(catchError(() => of(null)))
      .subscribe((res) => this.active.set(res));
  }

  protected startCreate(): void {
    this.creating.set(true);
    this.editingId.set(null);
    this.saveError.set(null);
    this.form.reset({ content: '', note: '', isActive: false });
  }

  protected startEdit(row: PromptOverride): void {
    this.editingId.set(row.id);
    this.creating.set(false);
    this.saveError.set(null);
    this.form.reset({
      content: row.content,
      note: row.note ?? '',
      isActive: row.isActive,
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.creating.set(false);
    this.saveError.set(null);
  }

  protected save(): void {
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    this.saving.set(true);
    this.saveError.set(null);

    const editingId = this.editingId();
    if (editingId) {
      this.api
        .update(editingId, {
          content: value.content,
          note: value.note || undefined,
          isActive: value.isActive,
        })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.cancelEdit();
            this.refresh(this.selectedAgent());
          },
          error: (err) => {
            this.saving.set(false);
            this.saveError.set(this.errorMessage(err, 'Failed to update prompt.'));
          },
        });
    } else {
      this.api
        .create({
          agent: this.selectedAgent(),
          content: value.content,
          note: value.note || undefined,
          isActive: value.isActive,
        })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.cancelEdit();
            this.refresh(this.selectedAgent());
          },
          error: (err) => {
            this.saving.set(false);
            this.saveError.set(this.errorMessage(err, 'Failed to create prompt.'));
          },
        });
    }
  }

  protected toggleActive(row: PromptOverride): void {
    this.api
      .update(row.id, { isActive: !row.isActive })
      .subscribe({
        next: () => this.refresh(this.selectedAgent()),
        error: (err) =>
          this.listError.set(this.errorMessage(err, 'Failed to toggle.')),
      });
  }

  protected openReplay(): void {
    this.replayOpen.set(true);
    this.replayResult.set(null);
    this.replayError.set(null);
    this.replayCandidate.set(this.active()?.active ?? '');
  }

  protected onReplayCandidateChange(value: string): void {
    this.replayCandidate.set(value);
  }

  protected runReplay(): void {
    const candidate = this.replayCandidate().trim();
    if (candidate.length < 10) {
      this.replayError.set('Candidate must be at least 10 chars.');
      return;
    }
    this.replayRunning.set(true);
    this.replayError.set(null);
    this.api
      .replay({
        agent: this.selectedAgent(),
        candidateContent: candidate,
        limit: 5,
      })
      .subscribe({
        next: (res) => {
          this.replayRunning.set(false);
          this.replayResult.set(res);
        },
        error: (err) => {
          this.replayRunning.set(false);
          this.replayError.set(
            this.errorMessage(err, 'Replay failed.')
          );
        },
      });
  }

  protected closeReplay(): void {
    this.replayOpen.set(false);
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; message?: string };
    return e?.error?.message ?? e?.message ?? fallback;
  }
}
