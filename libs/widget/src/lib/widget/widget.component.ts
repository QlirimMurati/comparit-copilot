import {
  ChangeDetectionStrategy,
  Component,
  Input,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { captureContext } from './context';
import { WidgetService } from './widget.service';
import type {
  CapturedContext,
  WidgetApiConfig,
  WidgetSparte,
} from './widget.types';

type WidgetMode = 'home' | 'bug' | 'feature' | 'ask';
interface ChatLine {
  role: 'user' | 'assistant';
  text: string;
}

const PROMPTS: Record<Exclude<WidgetMode, 'home'>, { title: string; greet: string }> = {
  bug: {
    title: 'Report a bug',
    greet: 'Was hast du angeklickt, und was hätte passieren sollen?',
  },
  feature: {
    title: 'Request a feature',
    greet: 'Beschreib kurz, was du dir wünschst — und wofür du es brauchst.',
  },
  ask: {
    title: 'Ask me something',
    greet: 'Frag los — ich helfe dir mit Reports, Sparten, Jira oder dem Code.',
  },
};

@Component({
  selector: 'lib-copilot-widget',
  imports: [ReactiveFormsModule],
  templateUrl: './widget.component.html',
  styleUrl: './widget.component.scss',
  encapsulation: ViewEncapsulation.ShadowDom,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WidgetService],
})
export class WidgetComponent {
  private readonly api = inject(WidgetService);
  private readonly fb = inject(FormBuilder);

  @Input() apiBase = 'http://localhost:3000';
  @Input() basicUser = 'widget';
  @Input() basicPass = 'local';
  @Input() reporterEmail: string | null = null;
  @Input() sparte: WidgetSparte | null = null;
  @Input() appVersion: string | null = null;

  // panel state
  protected readonly open = signal(false);
  protected readonly mode = signal<WidgetMode>('home');
  protected readonly capturedContext = signal<CapturedContext | null>(null);

  // chat state
  protected readonly chatSessionId = signal<string | null>(null);
  protected readonly chatMessages = signal<ChatLine[]>([]);
  protected readonly chatInput = this.fb.nonNullable.control('');
  protected readonly chatLoading = signal(false);
  protected readonly chatError = signal<string | null>(null);
  protected readonly chatComplete = signal(false);
  protected readonly chatSubmitting = signal(false);
  protected readonly chatSubmitError = signal<string | null>(null);
  protected readonly chatSubmitted = signal<string | null>(null);

  protected readonly modeTitle = computed(() => {
    const m = this.mode();
    return m === 'home' ? 'Workdesk' : PROMPTS[m].title;
  });

  protected toggle(): void {
    if (!this.open()) {
      this.capturedContext.set(
        captureContext({
          sparte: this.sparte,
          appVersion: this.appVersion,
          reporterEmail: this.reporterEmail,
        })
      );
    }
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
    this.resetAll();
  }

  protected backToHome(): void {
    this.mode.set('home');
    this.chatMessages.set([]);
    this.chatInput.setValue('');
    this.chatError.set(null);
    this.chatComplete.set(false);
    this.chatSubmitError.set(null);
    this.chatSubmitted.set(null);
    // keep sessionId so re-entering doesn't double-create
  }

  protected pickMode(m: Exclude<WidgetMode, 'home'>): void {
    this.mode.set(m);
    this.chatMessages.set([{ role: 'assistant', text: PROMPTS[m].greet }]);
    this.ensureSession();
  }

  /** Home-screen send: switch to "ask", seed the user message, fire it. */
  protected sendFromHome(): void {
    const text = this.chatInput.value.trim();
    if (!text) return;
    this.mode.set('ask');
    this.chatMessages.set([
      { role: 'assistant', text: PROMPTS.ask.greet },
      { role: 'user', text },
    ]);
    this.chatInput.setValue('');
    this.ensureSession((sid) => this.deliverMessage(sid, text));
  }

  protected sendMessage(): void {
    const text = this.chatInput.value.trim();
    if (!text || this.chatLoading()) return;
    const sid = this.chatSessionId();
    if (!sid) return;
    this.chatMessages.update((m) => [...m, { role: 'user', text }]);
    this.chatInput.setValue('');
    this.deliverMessage(sid, text);
  }

  private deliverMessage(sid: string, text: string): void {
    this.chatLoading.set(true);
    this.chatError.set(null);
    this.api.chatMessage(this.config(), { sessionId: sid, text }).subscribe({
      next: (res) => {
        this.chatMessages.update((m) => [
          ...m,
          { role: 'assistant', text: res.assistantText },
        ]);
        this.chatComplete.set(res.isComplete);
        this.chatLoading.set(false);
      },
      error: (err) => {
        this.chatLoading.set(false);
        this.chatError.set(this.errorMessage(err, 'Send failed'));
      },
    });
  }

  private ensureSession(after?: (sid: string) => void): void {
    const existing = this.chatSessionId();
    if (existing) {
      after?.(existing);
      return;
    }
    if (!this.reporterEmail) {
      this.chatError.set('reporter-email attribute is required for chat mode');
      return;
    }
    const ctx = this.capturedContext();
    if (!ctx) return;

    this.chatLoading.set(true);
    this.chatError.set(null);
    this.api
      .chatStart(this.config(), {
        reporterEmail: this.reporterEmail,
        capturedContext: ctx,
      })
      .subscribe({
        next: (res) => {
          this.chatSessionId.set(res.sessionId);
          // Don't override the mode-specific greeting we already showed.
          this.chatComplete.set(res.isComplete);
          this.chatLoading.set(false);
          after?.(res.sessionId);
        },
        error: (err) => {
          this.chatLoading.set(false);
          this.chatError.set(this.errorMessage(err, 'Chat could not start'));
        },
      });
  }

  protected submitChat(): void {
    const sid = this.chatSessionId();
    if (!sid) return;
    this.chatSubmitting.set(true);
    this.chatSubmitError.set(null);

    this.api.chatSubmit(this.config(), { sessionId: sid }).subscribe({
      next: (res) => {
        this.chatSubmitting.set(false);
        this.chatSubmitted.set(res.bugReportId);
        setTimeout(() => this.close(), 2000);
      },
      error: (err) => {
        this.chatSubmitting.set(false);
        this.chatSubmitError.set(this.errorMessage(err, 'Submit failed'));
      },
    });
  }

  private resetAll(): void {
    this.mode.set('home');
    this.chatSessionId.set(null);
    this.chatMessages.set([]);
    this.chatInput.setValue('');
    this.chatLoading.set(false);
    this.chatError.set(null);
    this.chatComplete.set(false);
    this.chatSubmitting.set(false);
    this.chatSubmitError.set(null);
    this.chatSubmitted.set(null);
  }

  private config(): WidgetApiConfig {
    return {
      apiBase: this.apiBase,
      basicUser: this.basicUser,
      basicPass: this.basicPass,
    };
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string }; status?: number };
    return (
      e?.error?.message ?? `${fallback} (${e?.status ?? 'network error'})`
    );
  }
}
