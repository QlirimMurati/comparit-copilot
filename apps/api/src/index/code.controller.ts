import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { SPARTEN, type Sparte } from '../db/schema';
import {
  CodeIndexService,
  type CodeSearchHit,
  type CodeSearchInput,
} from './code-index.service';

interface SearchBody {
  query: string;
  sparte?: string;
  limit?: number;
  maxDistance?: number;
}

@UseGuards(JwtAuthGuard)
@Controller('code')
export class CodeController {
  constructor(private readonly index: CodeIndexService) {}

  @Post('search')
  async search(
    @Body() body: SearchBody
  ): Promise<{ hits: CodeSearchHit[] }> {
    if (!body.query || body.query.trim().length < 3) {
      throw new BadRequestException('query required (min 3 chars)');
    }
    if (body.sparte && !SPARTEN.includes(body.sparte as Sparte)) {
      throw new BadRequestException(`invalid sparte '${body.sparte}'`);
    }
    const input: CodeSearchInput = {
      query: body.query,
      sparte: body.sparte ? (body.sparte as Sparte) : null,
      limit: body.limit,
      maxDistance: body.maxDistance,
    };
    const hits = await this.index.search(input);
    return { hits };
  }
}
