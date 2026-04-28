import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { ChunkService } from './chunk.service';
import { CodeController } from './code.controller';
import { CodeIndexService } from './code-index.service';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [CodeController],
  providers: [ChunkService, CodeIndexService],
  exports: [ChunkService, CodeIndexService],
})
export class IndexModule {}
