import { Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';
import { ChatSessionService } from './chat-session.service';
import { DedupService } from './dedup.service';
import { EmbedQueueService } from './embed.queue';
import { EmbedWorker } from './embed.worker';
import { IntakeAgentService } from './intake-agent.service';
import { IntakeController } from './intake.controller';
import { TicketPolisherService } from './ticket-polisher.service';
import { VoyageService } from './voyage.service';

@Module({
  controllers: [IntakeController],
  providers: [
    AnthropicService,
    ChatSessionService,
    IntakeAgentService,
    TicketPolisherService,
    VoyageService,
    EmbedQueueService,
    EmbedWorker,
    DedupService,
  ],
  exports: [
    AnthropicService,
    ChatSessionService,
    IntakeAgentService,
    TicketPolisherService,
    VoyageService,
    EmbedQueueService,
    DedupService,
  ],
})
export class AiModule {}
