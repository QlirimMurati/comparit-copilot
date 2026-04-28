import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreatePromptInput,
  PromptActiveResult,
  PromptAgent,
  PromptOverride,
  ReplayInput,
  ReplayResult,
  UpdatePromptInput,
} from './admin-prompts.types';

@Injectable({ providedIn: 'root' })
export class AdminPromptsService {
  private readonly http = inject(HttpClient);

  list(agent?: PromptAgent): Observable<{ rows: PromptOverride[] }> {
    let params = new HttpParams();
    if (agent) params = params.set('agent', agent);
    return this.http.get<{ rows: PromptOverride[] }>('/api/admin/prompts', {
      params,
    });
  }

  getActive(agent: PromptAgent): Observable<PromptActiveResult> {
    const params = new HttpParams().set('agent', agent);
    return this.http.get<PromptActiveResult>('/api/admin/prompts/active', {
      params,
    });
  }

  create(input: CreatePromptInput): Observable<PromptOverride> {
    return this.http.post<PromptOverride>('/api/admin/prompts', input);
  }

  update(id: string, patch: UpdatePromptInput): Observable<PromptOverride> {
    return this.http.patch<PromptOverride>(`/api/admin/prompts/${id}`, patch);
  }

  replay(input: ReplayInput): Observable<ReplayResult> {
    return this.http.post<ReplayResult>('/api/admin/prompts/replay', input);
  }
}
