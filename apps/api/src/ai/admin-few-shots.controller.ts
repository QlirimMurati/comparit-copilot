import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FEW_SHOT_AGENTS, type FewShotAgent } from '../db/schema';
import {
  FewShotRegistryService,
  type FewShotMessage,
} from './few-shot-registry.service';

interface CreateFewShotInput {
  agent: FewShotAgent;
  label: string;
  conversation: FewShotMessage[];
  isActive?: boolean;
}

interface UpdateFewShotInput {
  label?: string;
  conversation?: FewShotMessage[];
  isActive?: boolean;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'qa_lead')
@Controller('admin/few-shots')
export class AdminFewShotsController {
  constructor(private readonly registry: FewShotRegistryService) {}

  @Get()
  async list(@Query('agent') agent?: string) {
    if (agent && !FEW_SHOT_AGENTS.includes(agent as FewShotAgent)) {
      throw new BadRequestException(`invalid agent '${agent}'`);
    }
    const dbRows = await this.registry.listAllRowsForAdmin(
      agent ? (agent as FewShotAgent) : undefined
    );
    if (agent) {
      const merged = await this.registry.listForAgent(agent as FewShotAgent);
      return { rows: dbRows, mergedActive: merged };
    }
    return { rows: dbRows };
  }

  @Post()
  async create(@Body() body: CreateFewShotInput) {
    if (!FEW_SHOT_AGENTS.includes(body.agent)) {
      throw new BadRequestException(`invalid agent '${body.agent}'`);
    }
    if (!body.label || body.label.trim().length === 0) {
      throw new BadRequestException('label required');
    }
    if (!Array.isArray(body.conversation) || body.conversation.length === 0) {
      throw new BadRequestException('conversation must be a non-empty array');
    }
    for (const msg of body.conversation) {
      if (
        !msg ||
        (msg.role !== 'user' && msg.role !== 'assistant') ||
        typeof msg.text !== 'string'
      ) {
        throw new BadRequestException(
          `invalid conversation entry: ${JSON.stringify(msg)}`
        );
      }
    }
    return this.registry.create(body);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() body: UpdateFewShotInput) {
    if (
      body.conversation !== undefined &&
      (!Array.isArray(body.conversation) || body.conversation.length === 0)
    ) {
      throw new BadRequestException('conversation must be a non-empty array');
    }
    const row = await this.registry.update(id, body);
    if (!row) throw new NotFoundException(`few-shot ${id} not found`);
    return row;
  }
}
