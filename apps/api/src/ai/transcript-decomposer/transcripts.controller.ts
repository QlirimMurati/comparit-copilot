import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { TranscriptDecomposerService } from './transcript-decomposer.service';

interface StartInput {
  rawTranscript: string;
  title?: string;
}
interface RefineInput {
  instruction: string;
}

@UseGuards(JwtAuthGuard)
@Controller('transcripts')
export class TranscriptsController {
  constructor(private readonly decomposer: TranscriptDecomposerService) {}

  @Post()
  start(@Body() body: StartInput) {
    if (!body.rawTranscript || body.rawTranscript.trim().length < 50) {
      throw new BadRequestException('rawTranscript required (min 50 chars)');
    }
    return this.decomposer.start({
      rawTranscript: body.rawTranscript,
      title: body.title ?? null,
    });
  }

  @Post(':id/refine')
  refine(@Param('id') id: string, @Body() body: RefineInput) {
    if (!body.instruction || body.instruction.trim().length < 3) {
      throw new BadRequestException('instruction required (min 3 chars)');
    }
    return this.decomposer.refine(id, body.instruction);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.decomposer.getTree(id);
  }
}
