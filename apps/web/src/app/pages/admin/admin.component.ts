import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h2 class="text-2xl font-semibold tracking-tight">Admin</h2>
        <p class="text-sm text-slate-600">
          Manage AI prompts and few-shot examples used by the agents.
        </p>
      </header>

      <nav class="flex gap-2 border-b border-slate-200">
        <a
          routerLink="/admin/prompts"
          routerLinkActive="border-slate-900 text-slate-900"
          class="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          Prompts
        </a>
        <a
          routerLink="/admin/few-shots"
          routerLinkActive="border-slate-900 text-slate-900"
          class="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          Few-shots
        </a>
      </nav>

      <router-outlet />
    </section>
  `,
})
export class AdminComponent {}
