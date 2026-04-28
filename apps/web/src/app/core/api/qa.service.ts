import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { QaAskInput, QaAskResult } from './qa.types';

@Injectable({ providedIn: 'root' })
export class QaService {
  private readonly http = inject(HttpClient);

  ask(input: QaAskInput): Observable<QaAskResult> {
    return this.http.post<QaAskResult>('/api/qa/ask', input);
  }
}
