import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import type { AuthResult, PublicUser } from './auth.types';

const TOKEN_KEY = 'copilot.auth.token';
const USER_KEY = 'copilot.auth.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _user = signal<PublicUser | null>(this.loadUser());
  private readonly _token = signal<string | null>(this.loadToken());

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  token(): string | null {
    return this._token();
  }

  login(email: string, password: string): Observable<AuthResult> {
    return this.http
      .post<AuthResult>('/api/auth/login', { email, password })
      .pipe(tap((res) => this.persist(res)));
  }

  logout(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
    this._token.set(null);
    this._user.set(null);
    this.router.navigate(['/login']);
  }

  private persist(res: AuthResult): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    }
    this._token.set(res.token);
    this._user.set(res.user);
  }

  private loadToken(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  }

  private loadUser(): PublicUser | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicUser;
    } catch {
      return null;
    }
  }
}
