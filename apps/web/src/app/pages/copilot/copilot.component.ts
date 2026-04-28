import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CopilotService } from '../../core/api/copilot.service';
import type {
  BugSubmitData,
  ChatMessage,
  CodeLocalizationData,
  CopilotSessionSummary,
  DuplicateCheckData,
  JiraSearchData,
  TranscriptData,
} from '../../core/api/copilot.types';

@Component({
  selector: 'app-copilot',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './copilot.component.html',
  styleUrl: './copilot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopilotComponent implements OnInit {
  @ViewChild('messagesEnd') private messagesEnd!: ElementRef<HTMLDivElement>;

  private readonly api = inject(CopilotService);
  private readonly zone = inject(NgZone);

  protected readonly sessions = signal<CopilotSessionSummary[]>([]);
  protected readonly activeSessionId = signal<string | null>(null);
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly streaming = signal(false);
  protected readonly streamingText = signal('');
  protected readonly activeToolName = signal<string | null>(null);
  protected readonly streamingToolResults = signal<{ toolName: string; data: unknown }[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly loadingHistory = signal(false);
  protected inputText = '';

  protected readonly showSuggestions = computed(
    () => !this.activeSessionId() && this.messages().length === 0
  );

  ngOnInit(): void {
    this.loadSessions();
  }

  private loadSessions(): void {
    this.api.listSessions().subscribe({
      next: (s) => this.sessions.set(s),
      error: () => {},
    });
  }

  protected newSession(): void {
    this.activeSessionId.set(null);
    this.messages.set([]);
    this.streamingText.set('');
    this.error.set(null);
  }

  protected loadSession(id: string): void {
    if (id === this.activeSessionId()) return;
    this.activeSessionId.set(id);
    this.messages.set([]);
    this.loadingHistory.set(true);
    this.error.set(null);
    this.api.getMessages(id).subscribe({
      next: (msgs) => {
        this.messages.set(
          msgs.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            toolResults: m.toolResults ?? [],
            createdAt: new Date(m.createdAt),
          }))
        );
        this.loadingHistory.set(false);
        this.scrollBottom();
      },
      error: () => this.loadingHistory.set(false),
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    const text = event.dataTransfer?.getData('text/plain');
    if (text) {
      this.inputText = text;
    }
  }

  protected sendSuggestion(text: string): void {
    this.inputText = text;
    this.send();
  }

  protected async send(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.streaming()) return;
    this.inputText = '';
    this.error.set(null);

    // Ensure we have a session
    let sessionId = this.activeSessionId();
    if (!sessionId) {
      try {
        const created = await this.api.createSession().toPromise();
        if (!created) return;
        sessionId = created.sessionId;
        this.activeSessionId.set(sessionId);
        this.sessions.update((prev) => [
          { id: sessionId!, title: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          ...prev,
        ]);
      } catch (err) {
        this.error.set('Failed to create session.');
        return;
      }
    }

    // Append user message
    this.messages.update((msgs) => [
      ...msgs,
      { id: crypto.randomUUID(), role: 'user', text, toolResults: [], createdAt: new Date() },
    ]);
    this.scrollBottom();

    // Stream assistant response
    this.streaming.set(true);
    this.streamingText.set('');
    this.activeToolName.set(null);
    this.streamingToolResults.set([]);

    let accText = '';
    const toolResults: { toolName: string; data: unknown }[] = [];

    try {
      for await (const event of this.api.streamMessage(sessionId, text)) {
        this.zone.run(() => {
          if (event.type === 'text_delta') {
            accText += event.text;
            this.streamingText.set(accText);
            this.scrollBottom();
          } else if (event.type === 'tool_start') {
            this.activeToolName.set(event.toolName);
          } else if (event.type === 'tool_result') {
            this.activeToolName.set(null);
            toolResults.push({ toolName: event.toolName, data: event.data });
            this.streamingToolResults.set([...toolResults]);
          } else if (event.type === 'done' || event.type === 'error') {
            if (event.type === 'error') this.error.set(event.message);
            this.streaming.set(false);
            this.activeToolName.set(null);
            if (accText || toolResults.length > 0) {
              this.messages.update((msgs) => [
                ...msgs,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  text: accText,
                  toolResults: [...toolResults],
                  createdAt: new Date(),
                },
              ]);
            }
            this.streamingText.set('');
            this.streamingToolResults.set([]);

            // Refresh session list (title may have been set)
            this.loadSessions();
            this.scrollBottom();
          }
        });
      }
    } catch (err) {
      this.zone.run(() => {
        this.error.set((err as Error).message ?? 'Stream failed.');
        this.streaming.set(false);
      });
    }
  }

  private scrollBottom(): void {
    setTimeout(() => {
      this.messagesEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' });
    }, 0);
  }

  // Template helpers
  protected toolLabel(name: string): string {
    const labels: Record<string, string> = {
      update_bug_draft: 'Updating bug draft…',
      submit_bug_report: 'Creating bug report…',
      check_duplicates: 'Checking for duplicates…',
      search_jira: 'Searching Jira…',
      find_affected_code: 'Locating affected code…',
      decompose_transcript: 'Decomposing transcript…',
      validate_prefill: 'Validating prefill…',
      lookup_field_rule: 'Looking up field rule…',
      add_field_synonym: 'Saving synonym…',
    };
    return labels[name] ?? `Running ${name}…`;
  }

  protected asBugSubmit(data: unknown): BugSubmitData {
    return data as BugSubmitData;
  }

  protected asDuplicates(data: unknown): DuplicateCheckData {
    return data as DuplicateCheckData;
  }

  protected asJiraSearch(data: unknown): JiraSearchData {
    return data as JiraSearchData;
  }

  protected asTranscript(data: unknown): TranscriptData {
    return data as TranscriptData;
  }

  protected asCodeLocalization(data: unknown): CodeLocalizationData {
    return data as CodeLocalizationData;
  }
}
