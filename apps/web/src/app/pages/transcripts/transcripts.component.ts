import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranscriptsService } from '../../core/api/transcripts.service';
import type {
  TranscriptTreeNode,
  TranscriptTreeResult,
} from '../../core/api/transcripts.types';

@Component({
  selector: 'app-transcripts',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './transcripts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranscriptsComponent {
  private readonly api = inject(TranscriptsService);
  private readonly fb = inject(FormBuilder);

  protected readonly tree = signal<TranscriptTreeResult | null>(null);
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly startForm = this.fb.nonNullable.group({
    title: [''],
    rawTranscript: ['', [Validators.required, Validators.minLength(50)]],
  });

  protected readonly refineForm = this.fb.nonNullable.group({
    instruction: ['', [Validators.required, Validators.minLength(3)]],
  });

  protected start(): void {
    if (this.startForm.invalid) return;
    const value = this.startForm.getRawValue();
    this.running.set(true);
    this.error.set(null);
    this.api
      .start({
        title: value.title || undefined,
        rawTranscript: value.rawTranscript,
      })
      .subscribe({
        next: (res) => {
          this.running.set(false);
          this.tree.set(res);
        },
        error: (err) => {
          this.running.set(false);
          this.error.set(this.errorMessage(err, 'Failed to start decomposition.'));
        },
      });
  }

  protected refine(): void {
    const current = this.tree();
    if (!current || this.refineForm.invalid) return;
    const value = this.refineForm.getRawValue();
    this.running.set(true);
    this.error.set(null);
    this.api.refine(current.session.id, { instruction: value.instruction }).subscribe({
      next: (res) => {
        this.running.set(false);
        this.tree.set(res);
        this.refineForm.reset({ instruction: '' });
      },
      error: (err) => {
        this.running.set(false);
        this.error.set(this.errorMessage(err, 'Refine failed.'));
      },
    });
  }

  protected reset(): void {
    this.tree.set(null);
    this.startForm.reset({ title: '', rawTranscript: '' });
    this.refineForm.reset({ instruction: '' });
    this.error.set(null);
  }

  protected nodeBadgeClass(node: TranscriptTreeNode): string {
    switch (node.nodeType) {
      case 'epic':
        return 'bg-violet-100 text-violet-800';
      case 'story':
        return 'bg-sky-100 text-sky-800';
      case 'subtask':
        return 'bg-slate-100 text-slate-700';
    }
  }

  protected totalNodeCount(epics: TranscriptTreeNode[]): number {
    let n = 0;
    const walk = (nodes: TranscriptTreeNode[]): void => {
      for (const node of nodes) {
        n++;
        walk(node.children);
      }
    };
    walk(epics);
    return n;
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; message?: string };
    return e?.error?.message ?? e?.message ?? fallback;
  }
}
