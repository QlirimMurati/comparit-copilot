import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ChatMessageInput,
  ChatMessageResult,
  ChatStartInput,
  ChatStartResult,
  ChatSubmitInput,
  ChatSubmitResult,
  WidgetApiConfig,
  WidgetReportInput,
  WidgetReportResult,
} from './widget.types';

@Injectable()
export class WidgetService {
  private readonly http = inject(HttpClient);

  submit(
    config: WidgetApiConfig,
    input: WidgetReportInput
  ): Observable<WidgetReportResult> {
    return this.http.post<WidgetReportResult>(
      `${config.apiBase}/api/widget/reports`,
      input,
      this.basicAuthOptions(config)
    );
  }

  chatStart(
    config: WidgetApiConfig,
    input: ChatStartInput
  ): Observable<ChatStartResult> {
    return this.http.post<ChatStartResult>(
      `${config.apiBase}/api/widget/chat/start`,
      input,
      this.basicAuthOptions(config)
    );
  }

  chatMessage(
    config: WidgetApiConfig,
    input: ChatMessageInput
  ): Observable<ChatMessageResult> {
    return this.http.post<ChatMessageResult>(
      `${config.apiBase}/api/widget/chat/message`,
      input,
      this.basicAuthOptions(config)
    );
  }

  chatSubmit(
    config: WidgetApiConfig,
    input: ChatSubmitInput
  ): Observable<ChatSubmitResult> {
    return this.http.post<ChatSubmitResult>(
      `${config.apiBase}/api/widget/chat/submit`,
      input,
      this.basicAuthOptions(config)
    );
  }

  private basicAuthOptions(config: WidgetApiConfig) {
    const auth = btoa(`${config.basicUser}:${config.basicPass}`);
    return {
      headers: { Authorization: `Basic ${auth}` },
    };
  }
}
