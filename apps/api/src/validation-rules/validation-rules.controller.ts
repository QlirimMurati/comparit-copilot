import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type {
  UpsertValidationRule,
  ValidationRule,
} from './validation-rules.types';
import { ValidationRulesService } from './validation-rules.service';

@ApiTags('validation-rules')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('validation-rules')
export class ValidationRulesController {
  constructor(private readonly svc: ValidationRulesService) {}

  @ApiOperation({ summary: 'List validation rules (optionally filtered)' })
  @Get()
  list(
    @Query('sparte') sparte?: string,
    @Query('q') query?: string,
  ): Promise<ValidationRule[]> {
    return this.svc.list({ sparte, query });
  }

  @ApiOperation({ summary: 'Get a single validation rule by id' })
  @Get(':id')
  getById(@Param('id') id: string): Promise<ValidationRule> {
    return this.svc.getById(id);
  }

  @ApiOperation({ summary: 'Upsert a manual validation rule' })
  @Roles('admin', 'qa_lead')
  @Post()
  create(@Body() body: UpsertValidationRule): Promise<ValidationRule> {
    return this.svc.upsert(body, 'manual');
  }

  @ApiOperation({ summary: 'Patch an existing validation rule (becomes manual)' })
  @Roles('admin', 'qa_lead')
  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() body: Partial<UpsertValidationRule>,
  ): Promise<ValidationRule> {
    const existing = await this.svc.getById(id);
    return this.svc.upsert(
      {
        sparte: body.sparte ?? existing.sparte,
        fieldPath: body.fieldPath ?? existing.fieldPath,
        label: body.label ?? existing.label,
        type: body.type ?? existing.type,
        validators:
          body.validators ??
          (existing.validators as unknown as UpsertValidationRule['validators']),
        enumValues: body.enumValues ?? existing.enumValues ?? null,
        humanRule: body.humanRule ?? existing.humanRule,
        synonyms: body.synonyms ?? existing.synonyms,
      },
      'manual',
    );
  }

  @ApiOperation({ summary: 'Add a synonym to an existing rule' })
  @Post(':id/synonyms')
  addSynonym(
    @Param('id') id: string,
    @Body() body: { synonym: string },
  ): Promise<ValidationRule> {
    return this.svc.addSynonym(id, body.synonym);
  }

  @ApiOperation({ summary: 'Delete a validation rule' })
  @Roles('admin', 'qa_lead')
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.svc.delete(id);
  }
}
