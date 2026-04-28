import { Module } from '@nestjs/common';
import { AiModule } from '../ai.module';
import { AuthModule } from '../../auth/auth.module';
import { IndexModule } from '../../index/index.module';
import { JiraModule } from '../../jira/jira.module';
import { PrefillModule } from '../../prefill/prefill.module';
import { ValidationRulesModule } from '../../validation-rules/validation-rules.module';
import { CopilotAgentService } from './copilot-agent.service';
import { CopilotController } from './copilot.controller';
import { CopilotSessionService } from './copilot-session.service';

@Module({
  imports: [
    AuthModule,
    AiModule,
    IndexModule,
    JiraModule,
    PrefillModule,
    ValidationRulesModule,
  ],
  controllers: [CopilotController],
  providers: [CopilotAgentService, CopilotSessionService],
})
export class CopilotModule {}
