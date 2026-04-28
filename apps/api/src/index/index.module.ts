import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { CodeLocalizerService } from '../ai/code-localizer.service';
import { QaBotService } from '../ai/qa-bot.service';
import { QaController } from '../ai/qa.controller';
import { ChunkService } from './chunk.service';
import { CodeController } from './code.controller';
import { CodeIndexService } from './code-index.service';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [CodeController, QaController],
  providers: [
    ChunkService,
    CodeIndexService,
    CodeLocalizerService,
    QaBotService,
  ],
  exports: [
    ChunkService,
    CodeIndexService,
    CodeLocalizerService,
    QaBotService,
  ],
})
export class IndexModule {}
