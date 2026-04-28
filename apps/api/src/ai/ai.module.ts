import { Module } from '@nestjs/common';
import { WidgetModule } from '../widget/widget.module';
import { AnthropicService } from './anthropic.service';
import { ChatSessionService } from './chat-session.service';
import { IntakeAgentService } from './intake-agent.service';
import { IntakeController } from './intake.controller';

@Module({
  imports: [WidgetModule],
  controllers: [IntakeController],
  providers: [AnthropicService, ChatSessionService, IntakeAgentService],
  exports: [AnthropicService, ChatSessionService, IntakeAgentService],
})
export class AiModule {}
