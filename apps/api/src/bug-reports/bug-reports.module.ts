import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BugReportsController } from './bug-reports.controller';
import { BugReportsService } from './bug-reports.service';

@Module({
  imports: [AuthModule],
  controllers: [BugReportsController],
  providers: [BugReportsService],
  exports: [BugReportsService],
})
export class BugReportsModule {}
