import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import type {
  CopilotMessageRecord,
  CopilotSessionSummary,
  CopilotStreamEvent,
} from './copilot.types';

@Injectable({ providedIn: 'root' })
export class CopilotService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  createSession(): Observable<{ sessionId: string; title: string | null }> {
    return this.http.post<{ sessionId: string; title: string | null }>(
      '/api/copilot/sessions',
      {}
    );
  }

  listSessions(): Observable<CopilotSessionSummary[]> {
    return this.http.get<CopilotSessionSummary[]>('/api/copilot/sessions');
  }

  getMessages(sessionId: string): Observable<CopilotMessageRecord[]> {
    return this.http.get<CopilotMessageRecord[]>(
      `/api/copilot/sessions/${sessionId}/messages`
    );
  }

  async *streamMessage(
    sessionId: string,
    text: string
  ): AsyncIterable<CopilotStreamEvent> {
    const token = this.auth.token();
    const response = await fetch(`/api/copilot/sessions/${sessionId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6)) as CopilotStreamEvent;
          } catch {
            // malformed line — skip
          }
        }
      }
    }
  }
}
