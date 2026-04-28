import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" style="max-width: 1100px;">
      <div class="page-head">
        <div class="left">
          <h1 class="page-h">Admin</h1>
          <p class="page-sub">Manage AI prompts and few-shot examples used by the agents.</p>
        </div>
      </div>

      <nav class="tabs">
        <a routerLink="/admin/prompts" routerLinkActive #ra="routerLinkActive" [attr.data-active]="ra.isActive" class="tab" style="text-decoration: none;">Prompts</a>
        <a routerLink="/admin/few-shots" routerLinkActive #rb="routerLinkActive" [attr.data-active]="rb.isActive" class="tab" style="text-decoration: none;">Few-shots</a>
        <a routerLink="/admin/digests" routerLinkActive #rc="routerLinkActive" [attr.data-active]="rc.isActive" class="tab" style="text-decoration: none;">Digests</a>
      </nav>

      <router-outlet />
    </div>
  `,
})
export class AdminComponent {}
