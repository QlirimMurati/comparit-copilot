import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BasicAuthGuard } from './basic-auth.guard';
import { WidgetController } from './widget.controller';
import { WidgetService } from './widget.service';

@Module({
  imports: [AiModule, RealtimeModule],
  controllers: [WidgetController],
  providers: [WidgetService, BasicAuthGuard],
})
export class WidgetModule {}
