import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import type { UserRole } from './auth.types';

export const roleGuard = (allowed: UserRole[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const user = auth.user();
    if (!user) return router.parseUrl('/login');
    if (!allowed.includes(user.role)) return router.parseUrl('/');
    return true;
  };
};
