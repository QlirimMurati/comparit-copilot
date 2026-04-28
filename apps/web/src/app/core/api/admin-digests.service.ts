import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { DigestResult } from './admin-digests.types';

@Injectable({ providedIn: 'root' })
export class AdminDigestsService {
  private readonly http = inject(HttpClient);

  get(date: string): Observable<DigestResult> {
    return this.http.get<DigestResult>(`/api/admin/digests/${date}`);
  }

  run(date: string): Observable<DigestResult> {
    return this.http.post<DigestResult>('/api/admin/digests/run', { date });
  }
}
