import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { IndexModule } from '../index/index.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BugReportsController } from './bug-reports.controller';
import { BugReportsService } from './bug-reports.service';

@Module({
  imports: [AuthModule, AiModule, RealtimeModule, IndexModule],
  controllers: [BugReportsController],
  providers: [BugReportsService],
  exports: [BugReportsService],
})
export class BugReportsModule {}
