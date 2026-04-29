import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { AttachmentsService as AttachmentsApiService } from '../../core/api/attachments.service';
import { CopilotService } from '../../core/api/copilot.service';
import type {
  BugSubmitData,
  ChatAttachment,
  ChatMessage,
  CodeLocalizationData,
  CopilotSessionSummary,
  DuplicateCheckData,
  JiraPushPreview,
  JiraPushResult,
  JiraSearchData,
  TranscriptData,
} from '../../core/api/copilot.types';

interface PendingAttachment {
  localId: string;
  file: File;
  previewUrl: string;
  width: number | null;
  height: number | null;
  status: 'pending' | 'uploading' | 'error';
  error?: string;
}

const MAX_ATTACHMENTS = 4;
const MAX_BYTES = 5 * 1024 * 1024;

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
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  private readonly api = inject(CopilotService);
  private readonly attachmentsApi = inject(AttachmentsApiService);
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
  protected readonly pendingAttachments = signal<PendingAttachment[]>([]);
  protected readonly attachmentLimit = MAX_ATTACHMENTS;
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

  /**
   * Per-tool rotating status phrases shown while the tool is running.
   * Frontend-only — purely cosmetic to give the agent a sense of activity.
   */
  private readonly statusPhrases: Record<string, string[]> = {
    update_bug_draft: ['Saving draft…'],
    submit_bug_report: ['Saving the report…', 'Building Jira preview…', 'Linking back to copilot…'],
    check_duplicates: ['Looking at recent reports…', 'Cross-checking Jira…', 'Comparing similarity scores…'],
    search_jira: ['Building query…', 'Searching tickets…', 'Ranking matches…'],
    find_affected_code: ['Indexing files…', 'Searching by symbol…', 'Reading line ranges…'],
    decompose_transcript: ['Reading transcript…', 'Splitting into stories…', 'Drafting subtasks…'],
    validate_prefill: ['Loading schema…', 'Walking JSON…', 'Listing errors…'],
    lookup_field_rule: ['Looking up rule…', 'Matching synonyms…', 'Reading allowed values…'],
    add_field_synonym: ['Saving synonym…'],
  };
  protected readonly statusIdx = signal(0);
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly currentToolStatus = computed(() => {
    const tn = this.activeToolName();
    if (!tn) return null;
    const list = this.statusPhrases[tn] ?? [this.toolLabel(tn)];
    return list[this.statusIdx() % list.length];
  });

  constructor() {
    // Rotate status phrases every 700ms while a tool is running.
    effect(() => {
      const tn = this.activeToolName();
      if (this.statusTimer) {
        clearInterval(this.statusTimer);
        this.statusTimer = null;
      }
      this.statusIdx.set(0);
      if (tn) {
        this.statusTimer = setInterval(() => {
          this.zone.run(() => this.statusIdx.update((i) => i + 1));
        }, 700);
      }
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.statusTimer) clearInterval(this.statusTimer);
    });

    // Subscribed in constructor (injection context) so takeUntilDestroyed works.
    // This fires whenever ?session= or ?new= changes — driving session load
    // from the sidebar's chat-history clicks.
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
    this.clearPendingAttachments();
    setTimeout(() => this.composerInput?.nativeElement.focus(), 0);
  }

  protected loadSession(id: string): void {
    if (id === this.activeSessionId()) return;
    this.activeSessionId.set(id);
    this.messages.set([]);
    this.clearPendingAttachments();
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
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length > 0) {
      this.addAttachmentFiles(files);
      return;
    }
    const text = event.dataTransfer?.getData('text/plain');
    if (text) {
      this.inputText = text;
    }
  }

  protected openAttachmentPicker(): void {
    this.fileInput?.nativeElement?.click();
  }

  protected onAttachmentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) this.addAttachmentFiles(files);
    // reset so re-picking the same file re-fires change
    input.value = '';
  }

  protected removeAttachment(localId: string): void {
    this.pendingAttachments.update((list) => {
      const removed = list.find((p) => p.localId === localId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return list.filter((p) => p.localId !== localId);
    });
  }

  private addAttachmentFiles(files: File[]): void {
    const current = this.pendingAttachments();
    const remaining = MAX_ATTACHMENTS - current.length;
    if (remaining <= 0) {
      this.error.set(`At most ${MAX_ATTACHMENTS} attachments per message.`);
      return;
    }
    const accepted: PendingAttachment[] = [];
    for (const file of files.slice(0, remaining)) {
      if (!file.type.startsWith('image/')) {
        this.error.set('Only image files are supported for now.');
        continue;
      }
      if (file.size > MAX_BYTES) {
        this.error.set(`"${file.name}" is over the 5MB limit.`);
        continue;
      }
      accepted.push({
        localId: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        width: null,
        height: null,
        status: 'pending',
      });
    }
    if (accepted.length > 0) {
      this.pendingAttachments.update((list) => [...list, ...accepted]);
    }
  }

  private clearPendingAttachments(): void {
    for (const p of this.pendingAttachments()) {
      URL.revokeObjectURL(p.previewUrl);
    }
    this.pendingAttachments.set([]);
  }

  private async uploadPendingAttachments(
    sessionId: string
  ): Promise<ChatAttachment[]> {
    const pending = this.pendingAttachments();
    if (pending.length === 0) return [];
    const out: ChatAttachment[] = [];
    for (const p of pending) {
      try {
        const { base64, width, height } =
          await AttachmentsApiService.readAsBase64(p.file);
        const meta = await this.attachmentsApi
          .uploadForCopilot(sessionId, {
            kind: 'upload',
            contentType: p.file.type || 'image/png',
            base64Data: base64,
            filename: p.file.name,
            width,
            height,
          })
          .toPromise();
        if (!meta) continue;
        out.push({
          id: meta.id,
          previewUrl: p.previewUrl,
          filename: meta.filename,
          contentType: meta.contentType,
          width: meta.width,
          height: meta.height,
        });
      } catch (err) {
        this.error.set(
          `Failed to upload "${p.file.name}": ${(err as Error).message}`
        );
        // bail — the user message will still send without this attachment
      }
    }
    this.pendingAttachments.set([]);
    return out;
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
    // ngModel just clears the value — autosize set inline height earlier, so
    // a long-pasted textarea would stay tall after submit. Reset height here.
    queueMicrotask(() => {
      const el = this.composerInput?.nativeElement;
      if (el) el.style.height = 'auto';
    });
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

    const uploaded = await this.uploadPendingAttachments(sessionId);
    this.messages.update((msgs) => [
      ...msgs,
      {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        toolResults: [],
        createdAt: new Date(),
        attachments: uploaded.length > 0 ? uploaded : undefined,
      },
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

  protected asFixVersionNames(versions: Array<{ id?: string; name?: string }> | null | undefined): string {
    if (!versions || versions.length === 0) return '';
    return versions.map((v) => v.name ?? v.id ?? '').filter(Boolean).join(', ');
  }

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
