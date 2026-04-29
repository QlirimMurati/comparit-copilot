import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const handled = token
    ? next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))
    : next(req);
  return handled.pipe(
    catchError((err: unknown) => {
      // Token expired or otherwise rejected — clear local auth state and
      // bounce to /login so the user can re-authenticate, instead of
      // sitting on a broken page with "Failed to load …" forever.
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        token &&
        !req.url.includes('/api/auth/login')
      ) {
        auth.logout();
      }
      return throwError(() => err);
    })
  );
};
