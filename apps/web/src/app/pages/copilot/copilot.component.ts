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
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { CopilotService } from '../../core/api/copilot.service';
import type {
  BugSubmitData,
  ChatMessage,
  CodeLocalizationData,
  CopilotSessionSummary,
  DuplicateCheckData,
  JiraPushPreview,
  JiraPushResult,
  JiraSearchData,
  TranscriptData,
} from '../../core/api/copilot.types';

type JiraPushFlowState =
  | { stage: 'idle' }
  | { stage: 'previewing' }
  | { stage: 'preview'; preview: JiraPushPreview }
  | { stage: 'confirming'; preview: JiraPushPreview }
  | { stage: 'kept' }
  | { stage: 'pushed'; result: JiraPushResult }
  | { stage: 'error'; message: string };

@Component({
  selector: 'app-copilot',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './copilot.component.html',
  styleUrl: './copilot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopilotComponent implements OnInit {
  @ViewChild('messagesEnd') private messagesEnd!: ElementRef<HTMLDivElement>;
  @ViewChild('composerInput') private composerInput?: ElementRef<HTMLTextAreaElement>;

  private readonly api = inject(CopilotService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
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
  protected readonly jiraPush = signal<Record<string, JiraPushFlowState>>({});
  protected inputText = '';

  protected readonly showSuggestions = computed(
    () => !this.activeSessionId() && this.messages().length === 0 && !this.streaming()
  );

  protected readonly initials = computed(() => {
    const name = this.auth.user()?.name ?? '?';
    return name
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  });

  protected readonly greeting = computed(() => {
    const name = (this.auth.user()?.name ?? '').split(/\s+/)[0] || 'there';
    return `Hello, ${name}.`;
  });

  ngOnInit(): void {
    this.loadSessions();

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const sessionId = params.get('session');
      const isNew = params.get('new');
      if (isNew) {
        this.newSession();
      } else if (sessionId && sessionId !== this.activeSessionId()) {
        this.loadSession(sessionId);
      }
    });
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
    setTimeout(() => this.composerInput?.nativeElement.focus(), 0);
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
    const ta = event.target as HTMLTextAreaElement;
    queueMicrotask(() => this.autosize(ta));
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

  private autosize(ta: HTMLTextAreaElement): void {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  protected sendSuggestion(text: string): void {
    this.inputText = text;
    this.send();
  }

  protected prefillSuggestion(text: string): void {
    this.inputText = text;
    setTimeout(() => {
      const el = this.composerInput?.nativeElement;
      if (el) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
        this.autosize(el);
      }
    }, 0);
  }

  protected focusComposer(): void {
    this.inputText = '';
    setTimeout(() => this.composerInput?.nativeElement.focus(), 0);
  }

  protected async send(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.streaming()) return;
    this.inputText = '';
    this.error.set(null);

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

    this.messages.update((msgs) => [
      ...msgs,
      { id: crypto.randomUUID(), role: 'user', text, toolResults: [], createdAt: new Date() },
    ]);
    this.scrollBottom();

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

  protected asBugSubmit(data: unknown): BugSubmitData { return data as BugSubmitData; }
  protected asDuplicates(data: unknown): DuplicateCheckData { return data as DuplicateCheckData; }
  protected asJiraSearch(data: unknown): JiraSearchData { return data as JiraSearchData; }
  protected asTranscript(data: unknown): TranscriptData { return data as TranscriptData; }
  protected asCodeLocalization(data: unknown): CodeLocalizationData { return data as CodeLocalizationData; }

  protected jiraPushFor(reportId: string): JiraPushFlowState {
    return this.jiraPush()[reportId] ?? { stage: 'idle' };
  }

  private setJiraPush(reportId: string, state: JiraPushFlowState): void {
    this.jiraPush.update((m) => ({ ...m, [reportId]: state }));
  }

  protected startJiraPush(reportId: string): void {
    this.setJiraPush(reportId, { stage: 'previewing' });
    this.api.previewJiraPush(reportId).subscribe({
      next: (preview) => this.setJiraPush(reportId, { stage: 'preview', preview }),
      error: (err) =>
        this.setJiraPush(reportId, { stage: 'error', message: this.errMsg(err, 'Preview failed') }),
    });
  }

  protected confirmJiraPush(reportId: string, preview: JiraPushPreview): void {
    this.setJiraPush(reportId, { stage: 'confirming', preview });
    this.api.confirmJiraPush(reportId, preview.previewHash).subscribe({
      next: (result) => this.setJiraPush(reportId, { stage: 'pushed', result }),
      error: (err) =>
        this.setJiraPush(reportId, { stage: 'error', message: this.errMsg(err, 'Confirm failed') }),
    });
  }

  protected cancelJiraPush(reportId: string): void {
    this.setJiraPush(reportId, { stage: 'idle' });
  }

  protected keepAsReport(reportId: string): void {
    this.setJiraPush(reportId, { stage: 'kept' });
  }

  private errMsg(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; message?: string };
    return e?.error?.message ?? e?.message ?? fallback;
  }
}
