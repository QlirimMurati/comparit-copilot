import {
  ChangeDetectionStrategy,
  Component,
  Input,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { captureContext } from './context';
import { WidgetService } from './widget.service';
import type {
  CapturedContext,
  WidgetApiConfig,
  WidgetSeverity,
  WidgetSparte,
} from './widget.types';

const SEVERITIES: WidgetSeverity[] = ['blocker', 'high', 'medium', 'low'];
const SPARTEN: WidgetSparte[] = [
  'bu',
  'gf',
  'risikoleben',
  'kvv',
  'kvz',
  'hausrat',
  'phv',
  'wohngebaeude',
  'kfz',
  'basis_rente',
  'private_rente',
  'comparit',
];

type WidgetMode = 'chat' | 'form';
interface ChatLine {
  role: 'user' | 'assistant';
  text: string;
}

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

  protected readonly severities = SEVERITIES;
  protected readonly sparten = SPARTEN;

  // panel state
  protected readonly open = signal(false);
  protected readonly mode = signal<WidgetMode>('chat');
  protected readonly capturedContext = signal<CapturedContext | null>(null);
  protected readonly contextExpanded = signal(false);

  // form mode state
  protected readonly submitting = signal(false);
  protected readonly success = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(5)]],
    description: ['', [Validators.required, Validators.minLength(10)]],
    severity: ['medium' as WidgetSeverity, [Validators.required]],
    sparte: [null as WidgetSparte | null],
  });

  // chat mode state
  protected readonly chatSessionId = signal<string | null>(null);
  protected readonly chatMessages = signal<ChatLine[]>([]);
  protected readonly chatInput = this.fb.nonNullable.control('');
  protected readonly chatLoading = signal(false);
  protected readonly chatError = signal<string | null>(null);
  protected readonly chatComplete = signal(false);
  protected readonly chatSubmitting = signal(false);
  protected readonly chatSubmitError = signal<string | null>(null);
  protected readonly chatSubmitted = signal<string | null>(null);

  protected readonly capturedJson = computed(() => {
    const c = this.capturedContext();
    return c ? JSON.stringify(c, null, 2) : '';
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
      this.form.patchValue({ sparte: this.sparte });
      this.success.set(null);
      this.error.set(null);
      this.maybeKickoffChat();
    }
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
    this.resetChat();
  }

  protected toggleContext(event: Event): void {
    event.preventDefault();
    this.contextExpanded.update((v) => !v);
  }

  protected switchMode(m: WidgetMode): void {
    this.mode.set(m);
    if (m === 'chat') this.maybeKickoffChat();
  }

  // ---- form mode ---------------------------------------------------------

  protected submit(): void {
    if (this.form.invalid) return;
    if (!this.reporterEmail) {
      this.error.set('reporter-email attribute is required');
      return;
    }
    this.submitting.set(true);
    this.success.set(null);
    this.error.set(null);

    const value = this.form.getRawValue();
    const config = this.config();

    this.api
      .submit(config, {
        title: value.title,
        description: value.description,
        severity: value.severity,
        sparte: value.sparte,
        reporterEmail: this.reporterEmail,
        capturedContext: this.capturedContext() ?? undefined,
      })
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.success.set(`Submitted — report id ${res.id.slice(0, 8)}…`);
          this.form.reset({
            title: '',
            description: '',
            severity: 'medium',
            sparte: null,
          });
          setTimeout(() => this.close(), 1800);
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(
            err?.error?.message ??
              `Submit failed (${err?.status ?? 'network error'})`
          );
        },
      });
  }

  // ---- chat mode ---------------------------------------------------------

  private maybeKickoffChat(): void {
    if (this.mode() !== 'chat') return;
    if (this.chatSessionId()) return;
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
          this.chatMessages.set([
            { role: 'assistant', text: res.assistantText },
          ]);
          this.chatComplete.set(res.isComplete);
          this.chatLoading.set(false);
        },
        error: (err) => {
          this.chatLoading.set(false);
          this.chatError.set(this.errorMessage(err, 'Chat could not start'));
        },
      });
  }

  protected sendMessage(): void {
    const text = this.chatInput.value.trim();
    if (!text || this.chatLoading()) return;
    const sid = this.chatSessionId();
    if (!sid) return;

    this.chatMessages.update((m) => [...m, { role: 'user', text }]);
    this.chatInput.setValue('');
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

  private resetChat(): void {
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

  // ---- shared ------------------------------------------------------------

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
