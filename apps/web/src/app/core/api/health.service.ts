import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  check(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>('/api/health');
  }
}
