import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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

  protected readonly isAdmin = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'admin' || role === 'qa_lead';
  });

  protected logout(): void {
    this.auth.logout();
  }
}
