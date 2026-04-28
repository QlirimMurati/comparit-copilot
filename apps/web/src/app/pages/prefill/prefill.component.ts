import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { PrefillService } from '../../core/api/prefill.service';
import type {
  PrefillStage,
  SparteOption,
  ValidateResponse,
  ValidationError,
} from '../../core/api/prefill.types';

interface ResultError {
  error: string;
}

function extractFirstJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return trimmed.slice(0, i + 1);
    }
  }
  return trimmed;
}

@Component({
  selector: 'app-prefill',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prefill.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrefillComponent implements OnInit {
  private readonly api = inject(PrefillService);

  protected readonly sparten = signal<SparteOption[]>([]);
  protected readonly stage = signal<PrefillStage>('live');
  protected readonly sparte = signal<string>('');
  protected readonly json = signal<string>('');
  protected readonly result = signal<ValidateResponse | ResultError | null>(
    null,
  );
  protected readonly loading = signal(false);
  protected readonly autoDetected = signal<string | null>(null);

  protected readonly stages: PrefillStage[] = ['live', 'qa', 'dev'];

  protected readonly resultErrors = computed<ValidationError[]>(() => {
    const r = this.result();
    return r && 'valid' in r ? r.errors : [];
  });

  protected readonly isOk = computed(() => {
    const r = this.result();
    return !!r && 'valid' in r && r.valid;
  });

  protected readonly isErr = computed(() => {
    const r = this.result();
    return !!r && 'valid' in r && !r.valid;
  });

  protected readonly resultStage = computed<PrefillStage | null>(() => {
    const r = this.result();
    return r && 'stage' in r ? r.stage : null;
  });

  protected readonly schemaIsStatic = computed(() => {
    const r = this.result();
    return !!r && 'schemaSource' in r && r.schemaSource === 'static';
  });

  protected readonly errorMessage = computed<string | null>(() => {
    const r = this.result();
    return r && 'error' in r ? r.error : null;
  });

  constructor() {
    effect(() => {
      const raw = this.json();
      const list = this.sparten();
      try {
        const obj = JSON.parse(extractFirstJson(raw)) as {
          sparte?: string;
          prefillData?: { sparte?: string };
        };
        const detected = obj.sparte ?? obj.prefillData?.sparte;
        if (detected && list.some((s) => s.key === detected)) {
          this.sparte.set(detected);
          this.autoDetected.set(detected);
          return;
        }
      } catch {
        // ignore parse errors during typing
      }
      this.autoDetected.set(null);
    });
  }

  ngOnInit(): void {
    this.api
      .listSparten()
      .pipe(catchError(() => of<SparteOption[]>([])))
      .subscribe((list) => this.sparten.set(list));
  }

  protected setStage(s: PrefillStage): void {
    this.stage.set(s);
  }

  protected formatJson(): void {
    try {
      const parsed = JSON.parse(extractFirstJson(this.json())) as unknown;
      this.json.set(JSON.stringify(parsed, null, 2));
    } catch {
      // leave as-is
    }
  }

  protected onTextareaKeydown(ev: KeyboardEvent): void {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      this.validate();
    }
  }

  protected validate(): void {
    const sparte = this.sparte();
    const json = this.json().trim();
    if (!sparte) {
      this.result.set({ error: 'Select a Sparte first' });
      return;
    }
    if (!json) {
      this.result.set({ error: 'Paste JSON data first' });
      return;
    }
    this.loading.set(true);
    this.result.set(null);
    this.api
      .validate({ sparte, json, stage: this.stage() })
      .pipe(
        catchError((err: { error?: { message?: string } }) =>
          of<ResultError>({
            error: err.error?.message ?? 'Request failed',
          }),
        ),
      )
      .subscribe((res) => {
        this.loading.set(false);
        this.result.set(res);
        if ('cleanJson' in res && res.cleanJson) {
          try {
            this.json.set(
              JSON.stringify(JSON.parse(res.cleanJson) as unknown, null, 2),
            );
          } catch {
            // leave as-is
          }
        }
      });
  }

  protected stageBadgeTone(s: PrefillStage): string {
    switch (s) {
      case 'live':
        return 'bg-emerald-100 text-emerald-800';
      case 'qa':
        return 'bg-amber-100 text-amber-800';
      case 'dev':
        return 'bg-sky-100 text-sky-800';
    }
  }

  protected stageButtonTone(s: PrefillStage, active: boolean): string {
    if (!active) return 'bg-white text-slate-600 hover:bg-slate-50';
    switch (s) {
      case 'live':
        return 'bg-emerald-600 text-white';
      case 'qa':
        return 'bg-amber-500 text-white';
      case 'dev':
        return 'bg-sky-600 text-white';
    }
  }
}
