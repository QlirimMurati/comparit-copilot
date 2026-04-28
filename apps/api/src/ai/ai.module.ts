import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
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
import { TestCaseGeneratorService } from './test-case-generator.service';
import { TicketPolisherService } from './ticket-polisher.service';
import { TranscriptDecomposerService } from './transcript-decomposer/transcript-decomposer.service';
import { TranscriptsController } from './transcript-decomposer/transcripts.controller';
import { VoyageService } from './voyage.service';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [
    IntakeController,
    AdminFewShotsController,
    AdminPromptsController,
    TranscriptsController,
  ],
  providers: [
    AnthropicService,
    ChatSessionService,
    IntakeAgentService,
    TicketPolisherService,
    TestCaseGeneratorService,
    VoyageService,
    EmbedQueueService,
    EmbedWorker,
    DedupService,
    FewShotRegistryService,
    PromptRegistryService,
    TranscriptDecomposerService,
  ],
  exports: [
    AnthropicService,
    ChatSessionService,
    IntakeAgentService,
    TicketPolisherService,
    TestCaseGeneratorService,
    VoyageService,
    EmbedQueueService,
    DedupService,
    FewShotRegistryService,
    PromptRegistryService,
    TranscriptDecomposerService,
  ],
})
export class AiModule {}
