import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBasicAuth,
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import {
  AttachmentsService,
  type AttachmentMetadata,
  type CreateAttachmentInput,
} from './attachments.service';

interface UploadBody {
  kind?: 'screenshot' | 'upload';
  contentType?: string;
  base64Data?: string;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
  chatSessionId?: string | null;
  copilotSessionId?: string | null;
}

function coerceUpload(body: UploadBody): CreateAttachmentInput {
  if (!body.contentType || typeof body.contentType !== 'string') {
    throw new BadRequestException('contentType required');
  }
  if (!body.base64Data || typeof body.base64Data !== 'string') {
    throw new BadRequestException('base64Data required');
  }
  return {
    kind: body.kind === 'upload' ? 'upload' : 'screenshot',
    contentType: body.contentType,
    base64Data: body.base64Data,
    filename: body.filename ?? null,
    width: typeof body.width === 'number' ? body.width : null,
    height: typeof body.height === 'number' ? body.height : null,
    chatSessionId: body.chatSessionId ?? null,
    copilotSessionId: body.copilotSessionId ?? null,
  };
}

@ApiTags('attachments')
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @ApiBasicAuth('widget-basic')
  @ApiOperation({
    summary: 'Upload a chat-widget attachment (screenshot or file)',
    description:
      'Used by the embedded widget. Body must include `chatSessionId` so the attachment can be attached to the bug report on submit.',
  })
  @Post('widget/chat/attachment')
  async widgetUpload(
    @Body() body: UploadBody
  ): Promise<AttachmentMetadata> {
    if (!body.chatSessionId) {
      throw new BadRequestException(
        'chatSessionId required for widget uploads'
      );
    }
    return this.attachments.create(coerceUpload(body));
  }

  @ApiBearerAuth('jwt')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Upload a Workdesk copilot attachment',
    description:
      'Used by the apps/web Workdesk composer. Body must include `copilotSessionId`.',
  })
  @Post('copilot/attachment')
  async copilotUpload(
    @Body() body: UploadBody
  ): Promise<AttachmentMetadata> {
    if (!body.copilotSessionId) {
      throw new BadRequestException(
        'copilotSessionId required for copilot uploads'
      );
    }
    return this.attachments.create(coerceUpload(body));
  }

  @ApiBearerAuth('jwt')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List attachment metadata for a report' })
  @Get('reports/:id/attachments')
  list(@Param('id') id: string): Promise<AttachmentMetadata[]> {
    return this.attachments.listForReport(id);
  }

  @ApiBearerAuth('jwt')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Stream the raw bytes of an attachment',
    description:
      'Inline image/PNG (or whatever contentType was uploaded). Does NOT require the report id — attachment id is sufficient.',
  })
  @Get('attachments/:id')
  async stream(
    @Param('id') id: string,
    @Res() res: Response
  ): Promise<void> {
    const { contentType, bytes, filename } =
      await this.attachments.getBytes(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (filename) {
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(filename)}"`
      );
    }
    res.end(bytes);
  }
}
