import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  RefineTranscriptInput,
  StartTranscriptInput,
  TranscriptTreeResult,
} from './transcripts.types';

@Injectable({ providedIn: 'root' })
export class TranscriptsService {
  private readonly http = inject(HttpClient);

  start(input: StartTranscriptInput): Observable<TranscriptTreeResult> {
    return this.http.post<TranscriptTreeResult>('/api/transcripts', input);
  }

  refine(
    id: string,
    input: RefineTranscriptInput
  ): Observable<TranscriptTreeResult> {
    return this.http.post<TranscriptTreeResult>(
      `/api/transcripts/${id}/refine`,
      input
    );
  }

  get(id: string): Observable<TranscriptTreeResult> {
    return this.http.get<TranscriptTreeResult>(`/api/transcripts/${id}`);
  }
}
