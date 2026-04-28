import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { catchError, of } from 'rxjs';
import { AdminFewShotsService } from '../../../core/api/admin-few-shots.service';
import {
  FEW_SHOT_AGENTS,
  FEW_SHOT_AGENT_LABELS,
  type FewShotAgent,
  type FewShotExample,
  type FewShotMessage,
} from '../../../core/api/admin-few-shots.types';

interface ConvFormEntry {
  role: 'user' | 'assistant';
  text: string;
}

@Component({
  selector: 'app-admin-few-shots',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './few-shots.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FewShotsComponent {
  private readonly api = inject(AdminFewShotsService);
  private readonly fb = inject(FormBuilder);

  protected readonly agents = FEW_SHOT_AGENTS;
  protected readonly agentLabels = FEW_SHOT_AGENT_LABELS;

  protected readonly selectedAgent = signal<FewShotAgent>('intake');
  protected readonly rows = signal<FewShotExample[]>([]);
  protected readonly loading = signal(false);
  protected readonly listError = signal<string | null>(null);

  protected readonly editingId = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly form: FormGroup = this.fb.nonNullable.group({
    label: ['', [Validators.required]],
    isActive: [true],
    conversation: this.fb.array<FormGroup>([
      this.makeMessageGroup({ role: 'user', text: '' }),
    ]),
  });

  protected readonly empty = computed(
    () => !this.loading() && !this.listError() && this.rows().length === 0
  );

  constructor() {
    effect(() => this.refresh(this.selectedAgent()));
  }

  protected get conversation(): FormArray<FormGroup> {
    return this.form.get('conversation') as FormArray<FormGroup>;
  }

  protected onAgentChange(value: string): void {
    if ((FEW_SHOT_AGENTS as readonly string[]).includes(value)) {
      this.selectedAgent.set(value as FewShotAgent);
      this.cancelEdit();
    }
  }

  protected refresh(agent: FewShotAgent): void {
    this.loading.set(true);
    this.listError.set(null);
    this.api
      .list(agent)
      .pipe(catchError((err) => of({ rows: [], _error: err })))
      .subscribe((res) => {
        this.loading.set(false);
        if ('_error' in res) {
          this.listError.set(this.errorMessage(res['_error'], 'Failed to load few-shots.'));
          this.rows.set([]);
        } else {
          this.rows.set(res.rows);
        }
      });
  }

  protected startCreate(): void {
    this.creating.set(true);
    this.editingId.set(null);
    this.saveError.set(null);
    this.resetConversation([{ role: 'user', text: '' }]);
    this.form.patchValue({ label: '', isActive: true });
  }

  protected startEdit(row: FewShotExample): void {
    this.editingId.set(row.id);
    this.creating.set(false);
    this.saveError.set(null);
    this.resetConversation(row.conversation);
    this.form.patchValue({ label: row.label, isActive: row.isActive });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.creating.set(false);
    this.saveError.set(null);
  }

  protected addTurn(): void {
    const last = this.conversation.at(this.conversation.length - 1)?.value as
      | ConvFormEntry
      | undefined;
    const nextRole: 'user' | 'assistant' =
      last?.role === 'user' ? 'assistant' : 'user';
    this.conversation.push(this.makeMessageGroup({ role: nextRole, text: '' }));
  }

  protected removeTurn(index: number): void {
    if (this.conversation.length > 1) this.conversation.removeAt(index);
  }

  protected save(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const conversation = (raw.conversation as ConvFormEntry[])
      .map((m) => ({ role: m.role, text: m.text.trim() }))
      .filter((m) => m.text.length > 0);

    if (conversation.length === 0) {
      this.saveError.set('Conversation cannot be empty.');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);

    const editingId = this.editingId();
    if (editingId) {
      this.api
        .update(editingId, {
          label: raw.label,
          conversation,
          isActive: raw.isActive,
        })
        .subscribe({
          next: () => this.afterSave(),
          error: (err) => this.handleSaveError(err, 'Failed to update few-shot.'),
        });
    } else {
      this.api
        .create({
          agent: this.selectedAgent(),
          label: raw.label,
          conversation,
          isActive: raw.isActive,
        })
        .subscribe({
          next: () => this.afterSave(),
          error: (err) => this.handleSaveError(err, 'Failed to create few-shot.'),
        });
    }
  }

  protected toggleActive(row: FewShotExample): void {
    this.api.update(row.id, { isActive: !row.isActive }).subscribe({
      next: () => this.refresh(this.selectedAgent()),
      error: (err) =>
        this.listError.set(this.errorMessage(err, 'Failed to toggle.')),
    });
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  private afterSave(): void {
    this.saving.set(false);
    this.cancelEdit();
    this.refresh(this.selectedAgent());
  }

  private handleSaveError(err: unknown, fallback: string): void {
    this.saving.set(false);
    this.saveError.set(this.errorMessage(err, fallback));
  }

  private resetConversation(messages: FewShotMessage[]): void {
    while (this.conversation.length) this.conversation.removeAt(0);
    for (const m of messages) {
      this.conversation.push(this.makeMessageGroup(m));
    }
    if (this.conversation.length === 0) {
      this.conversation.push(this.makeMessageGroup({ role: 'user', text: '' }));
    }
  }

  private makeMessageGroup(m: FewShotMessage): FormGroup {
    return this.fb.nonNullable.group({
      role: [m.role],
      text: [m.text, [Validators.minLength(1)]],
    });
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; message?: string };
    return e?.error?.message ?? e?.message ?? fallback;
  }
}
