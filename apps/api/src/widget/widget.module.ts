import { Module } from '@nestjs/common';
import { BasicAuthGuard } from './basic-auth.guard';
import { WidgetController } from './widget.controller';
import { WidgetService } from './widget.service';

@Module({
  controllers: [WidgetController],
  providers: [WidgetService, BasicAuthGuard],
})
export class WidgetModule {}
