import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import type { CapturedContextShape } from './captured-context.types';

interface KV {
  key: string;
  value: string;
}

const ROUTE_KEYS: (keyof CapturedContextShape)[] = [
  'url',
  'pathname',
  'search',
  'hash',
  'sparte',
  'referrer',
];
const META_KEYS: (keyof CapturedContextShape)[] = [
  'appVersion',
  'timestamp',
  'locale',
  'timezone',
  'userAgent',
  'reporterEmail',
];

@Component({
  selector: 'lib-context-viewer',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (asObject(); as ctx) {
      <div class="space-y-4">
        @if (routeRows().length) {
          <section>
            <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Route</h4>
            <dl class="mt-1 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
              @for (row of routeRows(); track row.key) {
                <div class="grid grid-cols-[8rem_1fr] gap-2 px-3 py-1.5">
                  <dt class="text-slate-500">{{ row.key }}</dt>
                  <dd class="break-all font-mono text-xs text-slate-800">{{ row.value }}</dd>
                </div>
              }
            </dl>
          </section>
        }

        @if (idRows().length) {
          <section>
            <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-500">IDs</h4>
            <dl class="mt-1 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
              @for (row of idRows(); track row.key) {
                <div class="grid grid-cols-[8rem_1fr] gap-2 px-3 py-1.5">
                  <dt class="text-slate-500">{{ row.key }}</dt>
                  <dd class="break-all font-mono text-xs text-slate-800">{{ row.value }}</dd>
                </div>
              }
            </dl>
          </section>
        }

        @if (metaRows().length) {
          <section>
            <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Browser / app</h4>
            <dl class="mt-1 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
              @for (row of metaRows(); track row.key) {
                <div class="grid grid-cols-[8rem_1fr] gap-2 px-3 py-1.5">
                  <dt class="text-slate-500">{{ row.key }}</dt>
                  <dd class="break-all text-xs text-slate-800">{{ row.value }}</dd>
                </div>
              }
            </dl>
          </section>
        }

        @if (otherJson()) {
          <section>
            <button
              type="button"
              class="text-xs font-medium text-slate-600 hover:text-slate-900"
              (click)="toggleRaw()"
            >
              {{ rawOpen() ? '▾' : '▸' }} Other fields
            </button>
            @if (rawOpen()) {
              <pre class="mt-2 max-h-72 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-800">{{ otherJson() }}</pre>
            }
          </section>
        }
      </div>
    } @else {
      <pre class="max-h-72 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-800">{{ rawJson() }}</pre>
    }
  `,
})
export class ContextViewerComponent {
  readonly context = input<unknown>(null);

  protected readonly rawOpen = signal(false);

  protected readonly asObject = computed<CapturedContextShape | null>(() => {
    const ctx = this.context();
    if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
      return ctx as CapturedContextShape;
    }
    return null;
  });

  protected readonly routeRows = computed<KV[]>(() => {
    const ctx = this.asObject();
    if (!ctx) return [];
    const rows: KV[] = [];
    for (const key of ROUTE_KEYS) {
      const v = ctx[key];
      if (v !== undefined && v !== null && v !== '') {
        rows.push({ key: String(key), value: String(v) });
      }
    }
    if (ctx.viewport && typeof ctx.viewport === 'object') {
      rows.push({
        key: 'viewport',
        value: `${ctx.viewport.width}×${ctx.viewport.height}`,
      });
    }
    return rows;
  });

  protected readonly idRows = computed<KV[]>(() => {
    const ctx = this.asObject();
    if (!ctx?.ids || typeof ctx.ids !== 'object') return [];
    return Object.entries(ctx.ids).map(([key, value]) => ({
      key,
      value: String(value),
    }));
  });

  protected readonly metaRows = computed<KV[]>(() => {
    const ctx = this.asObject();
    if (!ctx) return [];
    const rows: KV[] = [];
    for (const key of META_KEYS) {
      const v = ctx[key];
      if (v !== undefined && v !== null && v !== '') {
        rows.push({ key: String(key), value: String(v) });
      }
    }
    return rows;
  });

  protected readonly otherJson = computed<string | null>(() => {
    const ctx = this.asObject();
    if (!ctx) return null;
    const known = new Set<string>([
      ...(ROUTE_KEYS as string[]),
      ...(META_KEYS as string[]),
      'ids',
      'viewport',
    ]);
    const other: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ctx)) {
      if (!known.has(key)) other[key] = value;
    }
    if (Object.keys(other).length === 0) return null;
    try {
      return JSON.stringify(other, null, 2);
    } catch {
      return String(other);
    }
  });

  protected readonly rawJson = computed<string>(() => {
    const ctx = this.context();
    if (ctx === null || ctx === undefined) return '';
    try {
      return JSON.stringify(ctx, null, 2);
    } catch {
      return String(ctx);
    }
  });

  protected toggleRaw(): void {
    this.rawOpen.update((v) => !v);
  }
}
