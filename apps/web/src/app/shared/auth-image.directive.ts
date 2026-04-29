import { HttpClient } from '@angular/common/http';
import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

/**
 * Sets <img src> to a blob URL fetched via HttpClient — so the auth
 * interceptor adds the Bearer token. Use for protected /api/attachments/:id
 * URLs that the browser cannot fetch directly via the src attribute.
 */
@Directive({
  selector: 'img[appAuthSrc]',
  standalone: true,
})
export class AuthImageDirective implements OnChanges, OnDestroy {
  @Input() appAuthSrc?: string;

  private readonly http = inject(HttpClient);
  private readonly el = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly destroy$ = new Subject<void>();
  private currentObjectUrl: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if ('appAuthSrc' in changes) {
      this.load();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.revoke();
  }

  private load(): void {
    const url = this.appAuthSrc;
    this.revoke();
    if (!url) return;
    this.http
      .get(url, { responseType: 'blob' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          this.currentObjectUrl = URL.createObjectURL(blob);
          this.el.nativeElement.src = this.currentObjectUrl;
        },
        error: () => {
          // Leave src empty so the browser shows the broken-image fallback.
        },
      });
  }

  private revoke(): void {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }
}
