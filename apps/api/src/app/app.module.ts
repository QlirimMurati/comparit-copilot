import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { BugReportsModule } from '../bug-reports/bug-reports.module';
import { DbModule } from '../db/db.module';
import { IndexModule } from '../index/index.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WidgetModule } from '../widget/widget.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    DbModule,
    AuthModule,
    BugReportsModule,
    WidgetModule,
    AiModule,
    RealtimeModule,
    IndexModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
