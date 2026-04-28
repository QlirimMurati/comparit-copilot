import { Route } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

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
        loadComponent: () =>
          import('./pages/home/home.component').then((m) => m.HomeComponent),
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
    ],
  },
];
