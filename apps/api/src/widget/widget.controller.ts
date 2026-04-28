import { Body, Controller, Post } from '@nestjs/common';
import { WidgetService } from './widget.service';
import type { WidgetReportInput, WidgetReportResult } from './widget.types';

@Controller('widget')
export class WidgetController {
  constructor(private readonly widget: WidgetService) {}

  @Post('reports')
  submit(@Body() body: WidgetReportInput): Promise<WidgetReportResult> {
    return this.widget.submit(body);
  }
}
