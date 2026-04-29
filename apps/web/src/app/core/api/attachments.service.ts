import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface AttachmentMetadata {
  id: string;
  kind: 'screenshot' | 'upload';
  filename: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface UploadAttachmentInput {
  kind: 'screenshot' | 'upload';
  contentType: string;
  base64Data: string;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
}

@Injectable({ providedIn: 'root' })
export class AttachmentsService {
  private readonly http = inject(HttpClient);

  uploadForCopilot(
    copilotSessionId: string,
    input: UploadAttachmentInput
  ): Observable<AttachmentMetadata> {
    return this.http.post<AttachmentMetadata>('/api/copilot/attachment', {
      ...input,
      copilotSessionId,
    });
  }

  listForReport(reportId: string): Observable<AttachmentMetadata[]> {
    return this.http.get<AttachmentMetadata[]>(
      `/api/reports/${reportId}/attachments`
    );
  }

  /** URL the browser can <img src> directly — auth is via cookie/JWT bearer header. */
  bytesUrl(attachmentId: string): string {
    return `/api/attachments/${attachmentId}`;
  }

  /**
   * Reads a File or Blob and resolves with the raw base64 (no data: prefix)
   * + intrinsic image dimensions when it's a raster image.
   */
  static async readAsBase64(
    file: File | Blob
  ): Promise<{ base64: string; width: number | null; height: number | null }> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.includes(',')
      ? dataUrl.slice(dataUrl.indexOf(',') + 1)
      : dataUrl;

    let width: number | null = null;
    let height: number | null = null;
    if ((file as File).type?.startsWith('image/')) {
      try {
        const dims = await new Promise<{ w: number; h: number }>(
          (resolve, reject) => {
            const img = new Image();
            img.onload = () =>
              resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => reject(new Error('image decode failed'));
            img.src = dataUrl;
          }
        );
        width = dims.w;
        height = dims.h;
      } catch {
        // fall through with null dims
      }
    }
    return { base64, width, height };
  }
}
