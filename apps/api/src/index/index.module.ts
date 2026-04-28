import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { CodeLocalizerService } from '../ai/code-localizer.service';
import { ChunkService } from './chunk.service';
import { CodeController } from './code.controller';
import { CodeIndexService } from './code-index.service';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [CodeController],
  providers: [ChunkService, CodeIndexService, CodeLocalizerService],
  exports: [ChunkService, CodeIndexService, CodeLocalizerService],
})
export class IndexModule {}
