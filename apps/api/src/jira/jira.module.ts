import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { JiraClient } from './jira.client';
import { JiraController } from './jira.controller';
import { JiraSyncQueueService } from './jira-sync.queue';
import { JqlBuilderService } from './jql-builder.service';
import { PushToJiraService } from './push-to-jira.service';
import { TicketsCacheService } from './tickets-cache.service';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [JiraController],
  providers: [
    JiraClient,
    JqlBuilderService,
    TicketsCacheService,
    JiraSyncQueueService,
    PushToJiraService,
  ],
  exports: [
    JiraClient,
    JqlBuilderService,
    TicketsCacheService,
    JiraSyncQueueService,
    PushToJiraService,
  ],
})
export class JiraModule {}
