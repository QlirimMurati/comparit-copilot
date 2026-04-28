import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  SparteOption,
  ValidateRequest,
  ValidateResponse,
} from './prefill.types';

@Injectable({ providedIn: 'root' })
export class PrefillService {
  private readonly http = inject(HttpClient);

  listSparten(): Observable<SparteOption[]> {
    return this.http.get<SparteOption[]>('/api/prefill/sparten');
  }

  validate(req: ValidateRequest): Observable<ValidateResponse> {
    return this.http.post<ValidateResponse>('/api/prefill/validate', req);
  }
}
