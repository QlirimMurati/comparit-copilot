import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import {
  attachments,
  type Attachment,
  type AttachmentKind,
} from '../db/schema';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export interface CreateAttachmentInput {
  kind: AttachmentKind;
  contentType: string;
  base64Data: string;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
  chatSessionId?: string | null;
  copilotSessionId?: string | null;
}

export interface AttachmentMetadata {
  id: string;
  kind: AttachmentKind;
  filename: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

@Injectable()
export class AttachmentsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(input: CreateAttachmentInput): Promise<AttachmentMetadata> {
    if (!ALLOWED_TYPES.has(input.contentType)) {
      throw new BadRequestException(
        `Unsupported contentType "${input.contentType}". Allowed: ${[...ALLOWED_TYPES].join(', ')}`
      );
    }
    const buffer = this.decodeBase64(input.base64Data);
    if (buffer.length === 0) {
      throw new BadRequestException('attachment is empty');
    }
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException(
        `attachment is too large (${buffer.length} bytes; max ${MAX_BYTES})`
      );
    }
    if (!input.chatSessionId && !input.copilotSessionId) {
      throw new BadRequestException(
        'either chatSessionId or copilotSessionId is required'
      );
    }
    const [row] = await this.db
      .insert(attachments)
      .values({
        kind: input.kind,
        filename: input.filename ?? null,
        contentType: input.contentType,
        sizeBytes: buffer.length,
        width: input.width ?? null,
        height: input.height ?? null,
        bytes: buffer,
        chatSessionId: input.chatSessionId ?? null,
        copilotSessionId: input.copilotSessionId ?? null,
      })
      .returning({
        id: attachments.id,
        kind: attachments.kind,
        filename: attachments.filename,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
        width: attachments.width,
        height: attachments.height,
        createdAt: attachments.createdAt,
      });
    return this.toMeta(row);
  }

  /**
   * Move all session-scoped orphan attachments onto the new bug report.
   * Called from the chat submit handler.
   */
  async linkSessionToReport(input: {
    chatSessionId?: string | null;
    copilotSessionId?: string | null;
    bugReportId: string;
  }): Promise<number> {
    let count = 0;
    if (input.chatSessionId) {
      const updated = await this.db
        .update(attachments)
        .set({ bugReportId: input.bugReportId })
        .where(
          and(
            eq(attachments.chatSessionId, input.chatSessionId),
            isNull(attachments.bugReportId)
          )
        )
        .returning({ id: attachments.id });
      count += updated.length;
    }
    if (input.copilotSessionId) {
      const updated = await this.db
        .update(attachments)
        .set({ bugReportId: input.bugReportId })
        .where(
          and(
            eq(attachments.copilotSessionId, input.copilotSessionId),
            isNull(attachments.bugReportId)
          )
        )
        .returning({ id: attachments.id });
      count += updated.length;
    }
    return count;
  }

  async listForReport(reportId: string): Promise<AttachmentMetadata[]> {
    const rows = await this.db
      .select({
        id: attachments.id,
        kind: attachments.kind,
        filename: attachments.filename,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
        width: attachments.width,
        height: attachments.height,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(eq(attachments.bugReportId, reportId))
      .orderBy(asc(attachments.createdAt));
    return rows.map((r) => this.toMeta(r));
  }

  async getBytes(id: string): Promise<{
    contentType: string;
    bytes: Buffer;
    filename: string | null;
  }> {
    const rows = await this.db
      .select({
        contentType: attachments.contentType,
        bytes: attachments.bytes,
        filename: attachments.filename,
      })
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`attachment ${id} not found`);
    }
    return {
      contentType: rows[0].contentType,
      bytes: Buffer.isBuffer(rows[0].bytes)
        ? rows[0].bytes
        : Buffer.from(rows[0].bytes),
      filename: rows[0].filename,
    };
  }

  async deleteOrphansOlderThan(hours: number): Promise<number> {
    const cutoff = new Date(Date.now() - hours * 3600_000);
    const deleted = await this.db
      .delete(attachments)
      .where(
        and(
          isNull(attachments.bugReportId),
          // any DB-side comparison would need raw SQL; simplest: compare in TS
        )
      )
      .returning({ id: attachments.id, createdAt: attachments.createdAt });
    return deleted.filter((d) => d.createdAt < cutoff).length;
  }

  private decodeBase64(input: string): Buffer {
    const cleaned = input.includes(',')
      ? input.slice(input.indexOf(',') + 1)
      : input;
    try {
      return Buffer.from(cleaned, 'base64');
    } catch {
      throw new BadRequestException('base64Data is not valid base64');
    }
  }

  private toMeta(row: Pick<
    Attachment,
    | 'id'
    | 'kind'
    | 'filename'
    | 'contentType'
    | 'sizeBytes'
    | 'width'
    | 'height'
    | 'createdAt'
  >): AttachmentMetadata {
    return {
      id: row.id,
      kind: row.kind,
      filename: row.filename,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
