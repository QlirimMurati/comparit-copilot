import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrefillController } from './prefill.controller';
import { PrefillService } from './prefill.service';

@Module({
  imports: [AuthModule],
  controllers: [PrefillController],
  providers: [PrefillService],
  exports: [PrefillService],
})
export class PrefillModule {}
