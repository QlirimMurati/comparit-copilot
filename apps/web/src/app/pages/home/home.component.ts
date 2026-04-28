import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { HealthService, HealthStatus } from '../../core/api/health.service';

type HealthState = HealthStatus | 'offline' | 'loading';

@Component({
  selector: 'app-home',
  imports: [],
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  private readonly health = inject(HealthService);

  protected readonly state = toSignal(
    this.health.check().pipe(catchError(() => of<HealthState>('offline'))),
    { initialValue: 'loading' as HealthState }
  );

  protected readonly statusLabel = computed(() => {
    const s = this.state();
    if (!s || s === 'loading') return 'Checking…';
    if (s === 'offline') return 'API offline';
    return `${s.service} · ${s.status} · v${s.version}`;
  });

  protected readonly statusTone = computed(() => {
    const s = this.state();
    if (!s || s === 'loading') return 'bg-slate-100 text-slate-700';
    if (s === 'offline') return 'bg-rose-100 text-rose-800';
    return 'bg-emerald-100 text-emerald-800';
  });
}
