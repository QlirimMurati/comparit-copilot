import { Module } from '@nestjs/common';
import { WidgetModule } from '../widget/widget.module';
import { AnthropicService } from './anthropic.service';
import { ChatSessionService } from './chat-session.service';
import { IntakeAgentService } from './intake-agent.service';
import { IntakeController } from './intake.controller';
import { TicketPolisherService } from './ticket-polisher.service';

@Module({
  imports: [WidgetModule],
  controllers: [IntakeController],
  providers: [
    AnthropicService,
    ChatSessionService,
    IntakeAgentService,
    TicketPolisherService,
  ],
  exports: [
    AnthropicService,
    ChatSessionService,
    IntakeAgentService,
    TicketPolisherService,
  ],
})
export class AiModule {}
