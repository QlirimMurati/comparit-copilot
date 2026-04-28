import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminFewShotsController } from './admin-few-shots.controller';
import { AdminPromptsController } from './admin-prompts.controller';
import { AnthropicService } from './anthropic.service';
import { ChatSessionService } from './chat-session.service';
import { DedupService } from './dedup.service';
import { EmbedQueueService } from './embed.queue';
import { EmbedWorker } from './embed.worker';
import { FewShotRegistryService } from './few-shot-registry.service';
import { IntakeAgentService } from './intake-agent.service';
import { IntakeController } from './intake.controller';
import { PromptRegistryService } from './prompt-registry.service';
import { TicketPolisherService } from './ticket-polisher.service';
import { VoyageService } from './voyage.service';

@Module({
  imports: [AuthModule],
  controllers: [
    IntakeController,
    AdminFewShotsController,
    AdminPromptsController,
  ],
  providers: [
    AnthropicService,
    ChatSessionService,
    IntakeAgentService,
    TicketPolisherService,
    VoyageService,
    EmbedQueueService,
    EmbedWorker,
    DedupService,
    FewShotRegistryService,
    PromptRegistryService,
  ],
  exports: [
    AnthropicService,
    ChatSessionService,
    IntakeAgentService,
    TicketPolisherService,
    VoyageService,
    EmbedQueueService,
    DedupService,
    FewShotRegistryService,
    PromptRegistryService,
  ],
})
export class AiModule {}
