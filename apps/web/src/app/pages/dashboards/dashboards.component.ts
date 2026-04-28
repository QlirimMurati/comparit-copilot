import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { BugReportsService } from '../../core/api/bug-reports.service';
import {
  SPARTE_LABELS,
  type BugReport,
  type ReportStatus,
  type Sparte,
} from '../../core/api/bug-reports.types';

interface SparteRow {
  sparte: Sparte | 'unspecified';
  label: string;
  count: number;
  open: number;
  resolved: number;
}

interface StatusRow {
  status: ReportStatus;
  count: number;
}

const OPEN_STATUSES = new Set<ReportStatus>(['new', 'triaged', 'in_progress']);
const RESOLVED_STATUSES = new Set<ReportStatus>([
  'resolved',
  'wontfix',
  'duplicate',
]);

@Component({
  selector: 'app-dashboards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboards.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardsComponent {
  private readonly api = inject(BugReportsService);

  private readonly reportsState = toSignal(
    this.api
      .list()
      .pipe(catchError(() => of<BugReport[] | 'error' | 'loading'>('error'))),
    { initialValue: 'loading' as BugReport[] | 'error' | 'loading' }
  );

  protected readonly hasError = computed(
    () => this.reportsState() === 'error'
  );
  protected readonly loading = computed(
    () => this.reportsState() === 'loading'
  );

  private readonly reports = computed<BugReport[]>(() => {
    const v = this.reportsState();
    return Array.isArray(v) ? v : [];
  });

  protected readonly total = computed(() => this.reports().length);

  protected readonly openCount = computed(
    () => this.reports().filter((r) => OPEN_STATUSES.has(r.status)).length
  );
  protected readonly resolvedCount = computed(
    () => this.reports().filter((r) => RESOLVED_STATUSES.has(r.status)).length
  );

  protected readonly avgTtrHours = computed<number | null>(() => {
    const resolved = this.reports().filter(
      (r) => r.status === 'resolved' && r.createdAt && r.updatedAt
    );
    if (resolved.length === 0) return null;
    const sumMs = resolved.reduce((acc, r) => {
      const created = new Date(r.createdAt).getTime();
      const updated = new Date(r.updatedAt).getTime();
      const delta = updated - created;
      return acc + Math.max(0, delta);
    }, 0);
    return sumMs / resolved.length / (1000 * 60 * 60);
  });

  protected readonly resolvedSampleSize = computed(
    () => this.reports().filter((r) => r.status === 'resolved').length
  );

  protected readonly statusRows = computed<StatusRow[]>(() => {
    const counts = new Map<ReportStatus, number>();
    for (const r of this.reports()) {
      counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  });

  protected readonly sparteRows = computed<SparteRow[]>(() => {
    const buckets = new Map<string, SparteRow>();
    for (const r of this.reports()) {
      const key = (r.sparte ?? 'unspecified') as Sparte | 'unspecified';
      const existing = buckets.get(key) ?? {
        sparte: key,
        label: r.sparte ? SPARTE_LABELS[r.sparte] : '— unspecified —',
        count: 0,
        open: 0,
        resolved: 0,
      };
      existing.count++;
      if (OPEN_STATUSES.has(r.status)) existing.open++;
      if (RESOLVED_STATUSES.has(r.status)) existing.resolved++;
      buckets.set(key, existing);
    }
    return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  });

  protected readonly maxCount = computed(() => {
    const rows = this.sparteRows();
    return rows.length > 0 ? Math.max(...rows.map((r) => r.count)) : 0;
  });

  protected barWidth(count: number): string {
    const max = this.maxCount();
    if (max === 0) return '0%';
    return `${Math.round((count / max) * 100)}%`;
  }

  protected formatTtr(hours: number): string {
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    if (hours < 48) return `${hours.toFixed(1)} h`;
    return `${(hours / 24).toFixed(1)} d`;
  }

  protected statusBadgeClass(s: ReportStatus): string {
    switch (s) {
      case 'new': return 'badge-new';
      case 'triaged': return 'badge-medium';
      case 'in_progress': return 'badge-progress';
      case 'resolved': return 'badge-resolved';
      case 'wontfix':
      case 'duplicate':
        return 'badge-low';
    }
  }
}
