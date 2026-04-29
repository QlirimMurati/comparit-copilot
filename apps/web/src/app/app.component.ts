import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/auth/auth.service';
import { CopilotService } from './core/api/copilot.service';
import type { CopilotSessionSummary } from './core/api/copilot.types';

type RouteKey = 'copilot' | 'reports' | 'dashboards' | 'prefill' | 'admin' | '';

const THEME_KEY = 'workdesk.theme';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly copilotApi = inject(CopilotService);

  protected readonly isAdmin = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'admin' || role === 'qa_lead';
  });

  protected readonly sessions = signal<CopilotSessionSummary[]>([]);
  protected readonly toolsOpen = signal(true);
  protected readonly searchTerm = signal('');
  protected readonly theme = signal<'light' | 'dark'>(this.loadTheme());

  private readonly _url = signal(this.router.url);

  protected readonly currentRoute = computed<RouteKey>(() => {
    const url = this._url();
    if (url.startsWith('/copilot')) return 'copilot';
    if (url.startsWith('/reports')) return 'reports';
    if (url.startsWith('/dashboards')) return 'dashboards';
    if (url.startsWith('/prefill')) return 'prefill';
    if (url.startsWith('/admin')) return 'admin';
    return '';
  });

  protected readonly showShell = computed(
    () =>
      this.auth.isAuthenticated() &&
      !this._url().startsWith('/login') &&
      !this._url().startsWith('/widget')
  );

  protected readonly pageTitle = computed(() => {
    const r = this.currentRoute();
    if (r === 'copilot') return { title: 'Workdesk', crumb: 'Chat' };
    if (r === 'reports') return { title: 'Reports', crumb: '' };
    if (r === 'dashboards') return { title: 'Dashboards', crumb: '' };
    if (r === 'prefill') return { title: 'Prefill', crumb: 'Validator' };
    if (r === 'admin') return { title: 'Admin', crumb: '' };
    return { title: 'Cpit Workdesk', crumb: '' };
  });

  protected readonly initials = computed(() => {
    const name = this.auth.user()?.name ?? '?';
    return name
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  });

  protected readonly groupedSessions = computed(() => {
    const search = this.searchTerm().toLowerCase().trim();
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);

    const groups: { label: string; items: CopilotSessionSummary[] }[] = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'This week', items: [] },
      { label: 'Earlier', items: [] },
    ];

    for (const s of this.sessions()) {
      if (search && !(s.title ?? '').toLowerCase().includes(search)) continue;
      const dt = new Date(s.updatedAt);
      if (dt >= today) groups[0].items.push(s);
      else if (dt >= yesterday) groups[1].items.push(s);
      else if (dt >= weekAgo) groups[2].items.push(s);
      else groups[3].items.push(s);
    }

    return groups.filter((g) => g.items.length > 0);
  });

  constructor() {
    this.applyTheme(this.theme());

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this._url.set(e.urlAfterRedirects);
      });

    effect(() => {
      this.applyTheme(this.theme());
    });

    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.copilotApi.listSessions().subscribe({
          next: (s) => this.sessions.set(s),
          error: () => {},
        });
      } else {
        this.sessions.set([]);
      }
    });
  }

  protected toggleTheme(): void {
    this.theme.update((t) => (t === 'light' ? 'dark' : 'light'));
  }

  protected toggleTools(): void {
    this.toolsOpen.update((v) => !v);
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  protected newChat(): void {
    this.router.navigate(['/copilot'], { queryParams: { new: Date.now() } });
  }

  protected openSession(id: string): void {
    this.router.navigate(['/copilot'], { queryParams: { session: id } });
  }

  protected deleteSession(id: string, title: string | null): void {
    const label = title?.trim() || 'this chat';
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    this.copilotApi.deleteSession(id).subscribe({
      next: () => {
        this.sessions.update((list) => list.filter((s) => s.id !== id));
        // If the user was viewing this session, drop the param so the
        // copilot page resets to "new chat" instead of trying to load a
        // 404'd session.
        const current = new URLSearchParams(window.location.search).get(
          'session'
        );
        if (current === id) {
          this.router.navigate(['/copilot']);
        }
      },
      error: (err) => {
        console.error('Failed to delete chat session', err);
      },
    });
  }

  protected logout(): void {
    this.auth.logout();
  }

  private loadTheme(): 'light' | 'dark' {
    if (typeof localStorage === 'undefined') return 'light';
    const v = localStorage.getItem(THEME_KEY);
    return v === 'dark' ? 'dark' : 'light';
  }

  private applyTheme(theme: 'light' | 'dark'): void {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset['theme'] = theme;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_KEY, theme);
    }
  }
}
