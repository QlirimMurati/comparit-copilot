import { Body, Controller, Post } from '@nestjs/common';
import { ApiBasicAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WidgetService } from './widget.service';
import type { WidgetReportInput, WidgetReportResult } from './widget.types';

@ApiTags('widget')
@ApiBasicAuth('widget-basic')
@Controller('widget')
export class WidgetController {
  constructor(private readonly widget: WidgetService) {}

  @ApiOperation({
    summary: 'Submit a bug report from the embedded widget',
    description:
      'Used by `<copilot-widget>`. Auth via HTTP Basic (`widget:local` from `.env`).',
  })
  @Post('reports')
  submit(@Body() body: WidgetReportInput): Promise<WidgetReportResult> {
    return this.widget.submit(body);
  }
}
