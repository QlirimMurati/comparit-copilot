import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateFewShotInput,
  FewShotAgent,
  FewShotExample,
  ListFewShotsResult,
  UpdateFewShotInput,
} from './admin-few-shots.types';

@Injectable({ providedIn: 'root' })
export class AdminFewShotsService {
  private readonly http = inject(HttpClient);

  list(agent?: FewShotAgent): Observable<ListFewShotsResult> {
    let params = new HttpParams();
    if (agent) params = params.set('agent', agent);
    return this.http.get<ListFewShotsResult>('/api/admin/few-shots', {
      params,
    });
  }

  create(input: CreateFewShotInput): Observable<FewShotExample> {
    return this.http.post<FewShotExample>('/api/admin/few-shots', input);
  }

  update(
    id: string,
    patch: UpdateFewShotInput
  ): Observable<FewShotExample> {
    return this.http.patch<FewShotExample>(
      `/api/admin/few-shots/${id}`,
      patch
    );
  }
}
