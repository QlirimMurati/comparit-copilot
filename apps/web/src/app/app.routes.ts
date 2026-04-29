import { Route } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'copilot',
      },
      {
        path: 'copilot',
        data: { fullscreen: true },
        loadComponent: () =>
          import('./pages/copilot/copilot.component').then(
            (m) => m.CopilotComponent
          ),
      },
      {
        path: 'reports',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/reports/reports.component').then(
            (m) => m.ReportsComponent
          ),
      },
      {
        path: 'reports/new',
        loadComponent: () =>
          import('./pages/reports/new/new-report.component').then(
            (m) => m.NewReportComponent
          ),
      },
      {
        path: 'reports/:id',
        loadComponent: () =>
          import('./pages/reports/detail/detail.component').then(
            (m) => m.ReportDetailComponent
          ),
      },
      {
        path: 'dashboards',
        loadComponent: () =>
          import('./pages/dashboards/dashboards.component').then(
            (m) => m.DashboardsComponent
          ),
      },
      {
        path: 'prefill',
        loadComponent: () =>
          import('./pages/prefill/prefill.component').then(
            (m) => m.PrefillComponent
          ),
      },
      {
        path: 'admin',
        canActivate: [roleGuard(['admin', 'qa_lead'])],
        loadComponent: () =>
          import('./pages/admin/admin.component').then((m) => m.AdminComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'prompts' },
          {
            path: 'prompts',
            loadComponent: () =>
              import('./pages/admin/prompts/prompts.component').then(
                (m) => m.PromptsComponent
              ),
          },
          {
            path: 'few-shots',
            loadComponent: () =>
              import('./pages/admin/few-shots/few-shots.component').then(
                (m) => m.FewShotsComponent
              ),
          },
          {
            path: 'digests',
            loadComponent: () =>
              import('./pages/admin/digests/digests.component').then(
                (m) => m.DigestsComponent
              ),
          },
        ],
      },
    ],
  },
];
