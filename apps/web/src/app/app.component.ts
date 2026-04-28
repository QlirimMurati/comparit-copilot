import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/auth/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly isAdmin = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'admin' || role === 'qa_lead';
  });

  private readonly _url = signal(this.router.url);

  protected readonly isFullscreen = computed(() =>
    this._url().startsWith('/copilot')
  );

  constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e) => {
        this._url.set((e as NavigationEnd).urlAfterRedirects);
      });
  }

  protected logout(): void {
    this.auth.logout();
  }
}
